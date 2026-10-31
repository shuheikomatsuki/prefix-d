import type RAPIER from '@dimforge/rapier3d';
import { type PhysicsWorld, carGroups } from './physics';
import {
  type DriverInput,
  type VehicleParams,
  DEFAULT_VEHICLE_PARAMS,
  stepVehicle,
} from './vehicle';

/** 車体の寸法（衝突体と見た目で共通） */
export const CAR_DIMENSIONS = {
  width: 1.9,
  length: 4.4,
  height: 1.1,
  wheelRadius: 0.36,
  /** 前輪・後輪の前後位置 */
  frontAxle: 1.35,
  rearAxle: -1.25,
  /** 左右のタイヤ位置 */
  track: 0.82,
};

/** 描画・カメラ・HUD・将来のネットワーク同期で使う、シリアライズ可能な車の状態 */
export interface CarSnapshot {
  x: number;
  y: number;
  z: number;
  /** ヨー角 [rad]（前方 +Z を 0 とし、左回りが正） */
  yaw: number;
  /** 前後方向の速度 [m/s] */
  forwardSpeed: number;
  /** 左右方向の速度 [m/s]（横滑り） */
  lateralSpeed: number;
  /** 舵角 [rad] */
  steerAngle: number;
  /** タイヤの回転角 [rad] */
  wheelSpin: number;
  /** 描画用: 車体の前後の傾き [rad]（前が上がると正）。坂道のマップだけ */
  pitch?: number;
  /** 描画用: 車体の左右の傾き [rad]（左が上がると正） */
  roll?: number;
  /** コース上の距離 [m]（中心線で描く道路のマップで、立体交差のどちらの道にいるかを見分けるため） */
  courseS?: number;
}

/** 置く位置。s はその位置のコース上の距離（分かっていれば） */
export interface Spawn {
  x: number;
  z: number;
  yaw: number;
  s?: number;
}

/** 重力加速度 [m/s^2] */
const GRAVITY = 9.81;
/** この速度未満でアクセルを踏んでいなければ、坂道でも止まっていられる（坂道発進の補助） */
const HILL_HOLD_SPEED = 0.5;
/** ぶつけられた直後に落ちるグリップの割合 */
const UPSET_GRIP_LOSS = 0.7;
/** 草地では、グリップがこの割合まで落ちる */
const GRASS_GRIP = 0.55;
/** 草地の転がり抵抗: 減速度 = GRASS_DRAG_BASE + GRASS_DRAG_PER_SPEED * v [m/s^2]（普通車は 40km/h くらいまでしか出ない） */
const GRASS_DRAG_BASE = 1.0;
const GRASS_DRAG_PER_SPEED = 0.33;
/**
 * 壁や他の車とこすれたときの摩擦の係数。ぶつかって押し戻された速さ（めり込む向きの速さ）に掛けた分だけ、
 * 前へ進む速さを失う。壁に押し付けて曲がる（壁走り）と、押し付けている間ずっと減速する
 */
const CONTACT_FRICTION = 0.8;
/** 押し戻された速さがこれ [m/s] 以下なら、触れていないとみなす（物理エンジンの誤差） */
const CONTACT_DEADZONE = 0.05;
/** 内側のタイヤを側溝に落としている間（溝落とし）、横に滑らずに曲がれる力がこの割合だけ増える */
const GUTTER_GRIP = 0.4;

/**
 * 物理ワールド内の1台の車。
 * 毎ステップ、剛体の速度を読み取り → 車両モデルで次の速度を計算 → 剛体に書き戻す。
 * 衝突による減速・停止は物理エンジンが解決し、次のステップで読み取る速度に反映される。
 */
export class Car {
  readonly body: RAPIER.RigidBody;
  params: VehicleParams;
  private steerAngle = 0;
  private wheelSpin = 0;
  /** 坂道のマップなら、その位置の地形の勾配。物理は平らなまま、坂の重力だけを前後の速度に加える */
  slope: ((x: number, z: number) => { x: number; z: number }) | null = null;
  /**
   * その位置がどれだけ道路の外か（0 = 舗装の上、1 = タイヤがすべて草地）。
   * 草地ではグリップが落ち、転がり抵抗で速度が出なくなる
   */
  offRoad: ((x: number, z: number) => number) | null = null;
  /**
   * 内側のタイヤがカーブの内側の側溝に落ちているか（溝落とし）。落ちている間は、溝の壁に引っかかって
   * 外へ逃げずに速く曲がれる（草地にもならない）
   */
  gutter: ((x: number, z: number) => boolean) | null = null;
  /** 段差で宙に浮いている間は true にする。タイヤが効かず、そのままの速さと向きで飛ぶ */
  airborne = false;
  /** 直前のステップで剛体に指示した水平速度（衝突の強さを測るため） */
  private commanded = { x: 0, z: 0 };
  /** bump で足した速度（接触の摩擦の計算から除く） */
  private pushed = { x: 0, z: 0 };
  /** ぶつけられて体勢を崩している残りの時間 [s]、その長さ、その間に足す向きの変わる速さ [rad/s] */
  private upset = { time: 0, length: 1, yawRate: 0 };
  /** コース上の距離（立体交差・往復のコースで、どちらの道にいるか）。分からなければ null */
  courseS: number | null = null;
  /**
   * 毎ステップの初めに、いまの位置からコース上の距離を更新し、走っている道の層を返す（中心線で描く道路のマップ）。
   * 層が変わると、ぶつかる壁が変わる
   */
  tracker: ((car: Car, x: number, z: number, yaw: number) => number) | null = null;
  private layer = -1;

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: Spawn,
    params: VehicleParams = DEFAULT_VEHICLE_PARAMS,
  ) {
    const { rapier, world } = physics;
    const { width, length, height } = CAR_DIMENSIONS;
    this.params = { ...params };
    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        // MVPでは横転させない（ヨー回転のみ許可）
        .enabledRotations(false, true, false)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    world.createCollider(
      rapier.ColliderDesc.cuboid(width / 2, height / 2, length / 2)
        // 車体の下端を剛体の原点（地面）に合わせる
        .setTranslation(0, height / 2 + 0.05, 0)
        .setMass(1200)
        // タイヤの摩擦は車両モデル側で扱うので、衝突体の摩擦はゼロにする（壁に沿って滑る）
        .setFriction(0)
        .setFrictionCombineRule(rapier.CoefficientCombineRule.Min)
        .setRestitution(0.1),
      this.body,
    );
    this.reset(spawn);
  }

  reset(spawn: Spawn): void {
    this.courseS = spawn.s ?? null;
    this.body.setTranslation({ x: spawn.x, y: 0.05, z: spawn.z }, true);
    this.body.setRotation(yawToQuat(spawn.yaw), true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.airborne = false;
    this.commanded = { x: 0, z: 0 };
    this.pushed = { x: 0, z: 0 };
    this.upset.time = 0;
  }

  /** 水平の速度を直接決める（テストで走っている状態から始めるため。衝突とはみなさない） */
  setVelocity(x: number, z: number): void {
    this.body.setLinvel({ x, y: this.body.linvel().y, z }, true);
    this.commanded = { x, z };
  }

  /**
   * 横からぶつけられたとき: 速度 push [m/s] を足し、time [s] の間はタイヤのグリップを落として向きを yawRate [rad/s] で回す
   * （外へ押し出され、スピンしかける）
   */
  bump(push: { x: number; z: number }, yawRate: number, time = 0.8): void {
    const v = this.body.linvel();
    this.body.setLinvel({ x: v.x + push.x, y: v.y, z: v.z + push.z }, true);
    this.pushed = { x: this.pushed.x + push.x, z: this.pushed.z + push.z };
    this.upset = { time, length: time, yawRate };
  }

  /** 物理ステップの前に呼ぶ */
  applyInput(input: DriverInput, dt: number): void {
    const yaw = quatToYaw(this.body.rotation());
    if (this.tracker) {
      const p = this.body.translation();
      this.setLayer(this.tracker(this, p.x, p.z, yaw));
    }
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // 左方向 = 前方を +90° 回したもの
    const lx = fz;
    const lz = -fx;

    const vel = this.body.linvel();
    // 前のステップで指示した速度から、物理エンジンが押し戻した分 = 壁や車に当たっている強さ
    const contact = Math.hypot(this.commanded.x + this.pushed.x - vel.x, this.commanded.z + this.pushed.z - vel.z);
    this.pushed = { x: 0, z: 0 };
    let forwardSpeed = vel.x * fx + vel.z * fz;
    // こすれている間は摩擦で進む速さを失う
    if (!this.airborne && contact > CONTACT_DEADZONE) forwardSpeed = Math.sign(forwardSpeed) * Math.max(0, Math.abs(forwardSpeed) - CONTACT_FRICTION * contact);
    const lateralSpeed = vel.x * lx + vel.z * lz;

    if (this.airborne) {
      this.commanded = { x: vel.x, z: vel.z };
      this.wheelSpin += (forwardSpeed / CAR_DIMENSIONS.wheelRadius) * dt;
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    const t = this.body.translation();
    const hooked = this.gutter?.(t.x, t.z) ?? false;
    const grass = this.offRoad && !hooked ? this.offRoad(t.x, t.z) : 0;
    let params =
      hooked
        ? { ...this.params, maxLateralAccel: this.params.maxLateralAccel * (1 + GUTTER_GRIP), lateralGrip: this.params.lateralGrip * (1 + GUTTER_GRIP) }
        : grass > 0
        ? {
            ...this.params,
            maxLateralAccel: this.params.maxLateralAccel * (1 - (1 - GRASS_GRIP) * grass),
            lateralGrip: this.params.lateralGrip * (1 - (1 - GRASS_GRIP) * grass),
          }
        : this.params;
    // ぶつけられた直後は、タイヤが滑って押された勢いのまま流れる（だんだん戻る）
    const upset = this.upset.time > 0 ? this.upset.time / this.upset.length : 0;
    if (upset > 0) {
      this.upset.time -= dt;
      const grip = 1 - UPSET_GRIP_LOSS * upset;
      params = { ...params, maxLateralAccel: params.maxLateralAccel * grip, lateralGrip: params.lateralGrip * grip };
    }
    const next = stepVehicle({ forwardSpeed, lateralSpeed, steerAngle: this.steerAngle }, input, params, dt);
    if (upset > 0) next.yawRate += this.upset.yawRate * upset;
    if (grass > 0) {
      const v = next.forwardSpeed;
      const drag = grass * (GRASS_DRAG_BASE + GRASS_DRAG_PER_SPEED * Math.abs(v)) * dt;
      next.forwardSpeed = Math.sign(v) * Math.max(0, Math.abs(v) - drag);
    }
    if (this.slope && !(Math.abs(next.forwardSpeed) < HILL_HOLD_SPEED && input.throttle === 0)) {
      const g = this.slope(t.x, t.z);
      // 進行方向の勾配 → 坂を下る向きの加速度 g・sinθ
      const grade = g.x * fx + g.z * fz;
      next.forwardSpeed -= (GRAVITY * grade * dt) / Math.sqrt(1 + grade * grade);
    }

    this.steerAngle = next.steerAngle;
    this.wheelSpin += (next.forwardSpeed / CAR_DIMENSIONS.wheelRadius) * dt;

    this.commanded = {
      x: fx * next.forwardSpeed + lx * next.lateralSpeed,
      z: fz * next.forwardSpeed + lz * next.lateralSpeed,
    };
    this.body.setLinvel({ x: this.commanded.x, y: vel.y, z: this.commanded.z }, true);
    this.body.setAngvel({ x: 0, y: next.yawRate, z: 0 }, true);
  }

  /** 走っている道の層（src/map/road.ts の LAYER_*）に合わせて、ぶつかる壁と車を変える */
  private setLayer(layer: number): void {
    if (layer === this.layer) return;
    this.layer = layer;
    for (let i = 0; i < this.body.numColliders(); i++) this.body.collider(i).setCollisionGroups(carGroups(layer));
  }

  /**
   * 物理ステップの後に呼ぶ。指示した速度と実際の速度の差から衝突の強さ [m/s] を返す。
   * 壁に押し付けているだけなら小さく、勢いよくぶつかると大きくなる。
   */
  measureImpact(): number {
    const v = this.body.linvel();
    return Math.hypot(this.commanded.x - v.x, this.commanded.z - v.z);
  }

  /** 物理ステップ後の実際の状態（衝突で止まっていれば速度は 0 になる） */
  snapshot(): CarSnapshot {
    const t = this.body.translation();
    const yaw = quatToYaw(this.body.rotation());
    const v = this.body.linvel();
    return {
      x: t.x,
      y: t.y,
      z: t.z,
      yaw,
      forwardSpeed: v.x * Math.sin(yaw) + v.z * Math.cos(yaw),
      lateralSpeed: v.x * Math.cos(yaw) - v.z * Math.sin(yaw),
      steerAngle: this.steerAngle,
      wheelSpin: this.wheelSpin,
      ...(this.courseS !== null ? { courseS: this.courseS } : {}),
    };
  }

  dispose(): void {
    this.physics.world.removeRigidBody(this.body);
  }
}

/** Y軸回転のみのクォータニオンからヨー角を取り出す */
function quatToYaw(q: { x: number; y: number; z: number; w: number }): number {
  return 2 * Math.atan2(q.y, q.w);
}

function yawToQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}
