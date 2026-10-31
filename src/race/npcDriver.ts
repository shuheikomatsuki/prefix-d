import type { CarSnapshot } from '../sim/car';
import { type DriverInput, NEUTRAL_INPUT, type VehicleParams, driveAccelAt, lateralAccelAt, steerLimitAt } from '../sim/vehicle';
import { type RacingLine, buildSpeedProfile } from './racingLine';

/** NPC の強さ */
export interface NpcLevel {
  id: string;
  label: string;
  /** 横方向のグリップを使う割合（大きいほどカーブを速く曲がる） */
  grip: number;
  /** ブレーキを使う割合（大きいほど奥まで突っ込んで強く止まる） */
  brake: number;
  /** レーシングラインをどれだけなぞるか（0 = 道路の中央、1 = 理想のライン） */
  line: number;
  /** 最高速度の割合 */
  topSpeed: number;
  /** 後ろから迫られたら、次のコーナーの内側を閉めて抜かせないようにするか */
  defend?: boolean;
}

export const NPC_LEVELS: readonly NpcLevel[] = [
  { id: 'easy', label: '初級', grip: 0.68, brake: 0.62, line: 0.3, topSpeed: 0.85 },
  { id: 'normal', label: '中級', grip: 0.82, brake: 0.76, line: 0.7, topSpeed: 0.93 },
  { id: 'hard', label: '上級', grip: 0.92, brake: 0.88, line: 1, topSpeed: 0.98, defend: true },
  { id: 'pro', label: '達人', grip: 0.97, brake: 0.95, line: 1, topSpeed: 1, defend: true },
  { id: 'legend', label: '伝説', grip: 1, brake: 1, line: 1, topSpeed: 1, defend: true },
];

/** 他の車の位置と速度（よけるため） */
export interface Opponent {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** ラフプレー（コーナーの手前でわざとぶつけて、相手をコースの外へ押し出す）の設定 */
export interface RoughStyle {
  /** 1回に狙い続ける最長の時間 [s] */
  duration: number;
  /** 1回狙ったあと、次に狙うまでの間 [s]（毎回当てると避けようがないので） */
  cooldown: number;
  /** 当てたときに相手を外へ押し出す速さ [m/s] */
  push: number;
  /** 当てたときに相手の向きを回す速さ [rad/s]（スピンしかける） */
  spin: number;
  /** 当てられた相手のタイヤが滑る時間 [s]（書かなければ 0.8） */
  upset?: number;
  /** 近づくときに、相手よりコーナーの内側へ寄る距離 [m]（書かなければ 2.2） */
  side?: number;
  /** 相手との前後の差がこれ [m] 以下になったら寄せて当てる（書かなければ 2.5 = 横に並んでから。大きくすると後ろから相手の後ろの角に当てる） */
  reach?: number;
}

/** ラフプレーで当てたとき、相手に与える力（Car.bump に渡す） */
export interface RoughHit {
  push: { x: number; z: number };
  yawRate: number;
  /** タイヤが滑る時間 [s] */
  time: number;
}

/** 狙い始めるのは、この先 [m] にこれ以上 [rad] 曲がるコーナーがあるとき */
const ATTACK_LOOK = 40;
const ATTACK_TURN = 0.35;
/** 当たったとみなす、車どうしの前後・左右の距離 [m]（車の長さ・幅より少し大きめ） */
const CONTACT_LENGTH = 4.6;
/** インを閉めるのは、この先 [m] にコーナー（ATTACK_TURN 以上曲がる）があって、後ろの車がこの距離 [m] 以内にいるとき */
const DEFEND_LOOK = 60;
const DEFEND_GAP = 12;
const CONTACT_WIDTH = 2.0;

/** 車どうしが触れているか（a の向きで見た前後・左右の距離が、車の長さ・幅くらいより近い） */
export function carsTouching(a: { x: number; z: number; yaw: number } | null, b: { x: number; z: number }): boolean {
  if (!a) return false;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const forward = dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw);
  const left = dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw);
  return Math.abs(forward) < CONTACT_LENGTH && Math.abs(left) < CONTACT_WIDTH;
}

/** 止まって動けなくなったとみなす時間 [s] */
const STUCK_SECONDS = 1.5;
/** 下がって抜け出す時間 [s] */
const REVERSE_SECONDS = 1.2;

/**
 * レース用の NPC の運転。レーシングラインを先読みしてハンドルを切り（pure pursuit）、
 * 速度の計画に合わせてアクセルとブレーキを踏む。前の車に追いついたら横に出て抜き、抜けなければ速度を合わせる。
 */
export class NpcDriver {
  private readonly speed: Float64Array;
  private readonly lineX: Float64Array;
  private readonly lineZ: Float64Array;
  private stuckTime = 0;
  private reverseTime = 0;
  /** 追い越しのために足している、ラインからの横のずれ [m]（なめらかに変える） */
  private sideShift = 0;
  private lastSteer = 0;
  /** 1 より小さくすると全体にゆっくり走る（ゴール後のクールダウン） */
  pace = 1;
  /** 直前にいたコース上の距離（立体交差や往復のコースで取り違えないため） */
  private hint: number | null = null;
  /** ラフプレーをするなら、その設定（update の target を狙う） */
  rough: RoughStyle | null = null;
  /** いま狙っている残りの時間 [s]（0 なら狙っていない） */
  private attackTime = 0;
  /** 次に狙えるまでの時間 [s] */
  private attackCooldown = 0;
  /** 当たってから、押し切るまでの残りの時間 [s] */
  private pushTime = 0;
  /** 当てたばかりで、まだ相手に伝えていない力 */
  private hit: RoughHit | null = null;

  constructor(
    private readonly line: RacingLine,
    private readonly params: VehicleParams,
    readonly level: NpcLevel,
    /** 同じ強さの NPC どうしでも少し差がつくよう、速度にかける係数 */
    variation = 1,
    gradient?: (x: number, z: number, s: number) => { x: number; z: number },
  ) {
    const p = { ...params, maxForwardSpeed: params.maxForwardSpeed * level.topSpeed };
    this.speed = buildSpeedProfile(line, p, { grip: level.grip * variation, brake: level.brake, gradient });
    // 弱い NPC は、理想のラインより道路の中央寄りを走る
    const course = line.course;
    this.lineX = new Float64Array(line.count);
    this.lineZ = new Float64Array(line.count);
    for (let i = 0; i < line.count; i++) {
      const c = course.pointAt(i * line.step);
      const off = line.offset[i] * level.line;
      this.lineX[i] = c.x + Math.cos(c.yaw) * off;
      this.lineZ[i] = c.z - Math.sin(c.yaw) * off;
    }
  }

  /** ライン上の距離 s [m] の点の番号 */
  private indexAt(s: number): number {
    const n = this.line.count;
    const i = Math.round(s / this.line.step);
    return this.line.course.closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
  }

  /** s での目標速度（その先の少しの区間の最小値。反応の遅れを見込む） */
  targetSpeed(s: number, ahead: number): number {
    let v = Infinity;
    for (let d = 0; d <= ahead; d += this.line.step) v = Math.min(v, this.speed[this.indexAt(s + d)]);
    return v;
  }

  /** ラフプレーで当てたときの、相手に与える力（1回だけ返す） */
  takeHit(): RoughHit | null {
    const h = this.hit;
    this.hit = null;
    return h;
  }

  /** いま後ろの車に対してインを閉めているか */
  defending = false;

  /** いまラフプレーで狙っているか */
  get attacking(): boolean {
    return this.attackTime > 0;
  }

  /** s から ahead [m] 先までに向きが変わる量 [rad]（正は左へ曲がる） */
  private turnAhead(s: number, ahead: number): number {
    const course = this.line.course;
    const d = course.pointAt(this.clampS(s + ahead)).yaw - course.pointAt(this.clampS(s)).yaw;
    return Math.atan2(Math.sin(d), Math.cos(d));
  }

  /** コース上で、相手が自分より何 m 前にいるか（後ろなら負） */
  private gapTo(o: Opponent, s: number): number {
    const course = this.line.course;
    const ov = Math.hypot(o.vx, o.vz);
    const op = course.project(o.x, o.z, { s, dir: ov > 1 ? { x: o.vx / ov, z: o.vz / ov } : null });
    const gap = op.s - s;
    return course.closed ? ((gap % course.length) + course.length * 1.5) % course.length - course.length / 2 : gap;
  }

  private clampS(s: number): number {
    const course = this.line.course;
    return course.closed ? ((s % course.length) + course.length) % course.length : Math.min(course.length, Math.max(0, s));
  }

  /**
   * ラフプレー: コーナーの手前で相手に並びかけ、内側から当てて外へ押し出す。
   * 狙うなら、向かう点（コース上の距離 s と道の中央からの横のずれ offset）と目標の速さを返す
   */
  private attack(dt: number, here: { s: number; offset: number }, v: number, target: Opponent): { s: number; offset: number; speed: number } | null {
    const style = this.rough!;
    const course = this.line.course;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    const tv = Math.hypot(target.vx, target.vz);
    const tp = course.project(target.x, target.z, { s: here.s, dir: tv > 1 ? { x: target.vx / tv, z: target.vz / tv } : null });
    let gap = tp.s - here.s;
    if (course.closed) gap = ((gap % course.length) + course.length * 1.5) % course.length - course.length / 2;
    const lateral = tp.offset - here.offset;
    const turn = this.turnAhead(here.s, ATTACK_LOOK);
    const stop = () => {
      this.attackTime = 0;
      this.pushTime = 0;
      this.hit = null;
      this.attackCooldown = style.cooldown;
      return null;
    };
    if (this.attackTime <= 0) {
      // 相手が少し前か横にいて、この先にコーナーがあるときに狙い始める
      if (this.attackCooldown > 0 || v < 8 || gap < -1.5 || gap > 10 || Math.abs(lateral) > 5 || Math.abs(turn) < ATTACK_TURN) return null;
      this.attackTime = style.duration;
    }
    this.attackTime -= dt;
    // 抜かれた・離された・時間切れなら、やめて間を空ける
    if (this.attackTime <= 0 || gap < -4 || gap > 18) return stop();
    // コーナーの内側（左へ曲がるなら左 = 正）
    const inside = Math.sign(turn) || 1;
    if (this.pushTime > 0) {
      this.pushTime -= dt;
      if (this.pushTime <= 0) return stop();
    } else if (carsTouching(this.last, target)) {
      // 当たったら、相手をコーナーの外へ押し出して向きを回す（自分が落ちないよう、すぐにラインへ戻る）
      this.pushTime = 0.2;
      const yaw = course.pointAt(this.clampS(tp.s)).yaw;
      const out = -inside;
      this.hit = { push: { x: Math.cos(yaw) * out * style.push, z: -Math.sin(yaw) * out * style.push }, yawRate: inside * style.spin, time: style.upset ?? 0.8 };
    }
    const limit = course.widthAt(here.s) / 2 - 1.6;
    const clamp = (o: number) => Math.max(-limit, Math.min(limit, o));
    const planned = this.targetSpeed(here.s, Math.max(4, v * 0.25));
    // 横に並ぶまでは相手より速く（ただしコーナーを曲がりきれる速さの少し上まで）
    if (gap > (style.reach ?? 2.5)) {
      const ahead = here.s + Math.max(6, v * 0.4);
      return { s: ahead, offset: clamp(tp.offset + inside * (style.side ?? 2.2)), speed: planned };
    }
    // 並んだら、相手のいる所より外へ寄せてぶつける（近い点を狙って鋭く寄せる）
    const ahead = here.s + Math.max(4, v * 0.2);
    const toward = (here.offset - tp.offset) * inside > 0 ? -inside : Math.sign(tp.offset - here.offset) || -inside;
    return { s: ahead, offset: clamp(tp.offset + toward * 1.5), speed: Math.min(planned, tv + 1) };
  }

  private last: CarSnapshot | null = null;

  update(dt: number, car: CarSnapshot, opponents: readonly Opponent[], mark?: Opponent): DriverInput {
    const course = this.line.course;
    const p = this.params;
    const v = car.forwardSpeed;

    // 壁などに引っかかって止まったら、少し下がってやり直す
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      // 下がりながら、行きたい向きと逆にハンドルを切って向きを直す
      return { throttle: 0, brake: 1, steer: -this.lastSteer };
    }
    this.stuckTime = Math.abs(v) < 1 ? this.stuckTime + dt : 0;
    if (this.stuckTime > STUCK_SECONDS) {
      this.stuckTime = 0;
      this.reverseTime = REVERSE_SECONDS;
      return NEUTRAL_INPUT;
    }

    const sin = Math.sin(car.yaw);
    const cos = Math.cos(car.yaw);
    const here = course.project(car.x, car.z, { s: this.hint, dir: { x: sin, z: cos } });
    this.hint = here.s;
    this.last = car;
    const aim = this.rough && mark ? this.attack(dt, here, v, mark) : null;

    // --- 前の車 ---
    let follow = Infinity;
    let wantShift = 0;
    const limit = course.widthAt(here.s) / 2 - 1.4;
    for (const o of aim ? [] : opponents) {
      const ov2 = Math.hypot(o.vx, o.vz);
      const op = course.project(o.x, o.z, { s: here.s, dir: ov2 > 1 ? { x: o.vx / ov2, z: o.vz / ov2 } : null });
      let gap = op.s - here.s;
      if (course.closed) gap = ((gap % course.length) + course.length * 1.5) % course.length - course.length / 2;
      if (gap <= 0 || gap > 30) continue;
      const lateral = op.offset - here.offset;
      if (Math.abs(lateral) > 3) continue;
      const ov = o.vx * sin + o.vz * cos;
      const closing = v - ov;
      if (closing <= 0.5 && gap > 8) continue;
      // 空いている側へ出る（道幅に余裕があるほう）
      const roomLeft = limit - op.offset;
      const roomRight = op.offset + limit;
      const side = roomLeft > roomRight ? 1 : -1;
      const target = op.offset + side * 3.2 - this.line.offset[this.indexAt(here.s)] * this.level.line;
      wantShift = Math.abs(target) > Math.abs(wantShift) ? target : wantShift;
      // 横に並ぶ余裕がなければ、ぶつからないよう速度を合わせる
      const room = side > 0 ? roomLeft : roomRight;
      // 詰まる速さが大きいほど、ブレーキが間に合うよう早めに合わせる
      if (room < 3 || gap < 6 + (Math.max(0, closing) ** 2) / p.brakeDecel) follow = Math.min(follow, ov + Math.max(0, gap - 5) * 0.6);
    }
    // 後ろから迫られたら、次のコーナーの内側へ寄せてインを閉める（抜くにはブレーキングか立ち上がりで勝つしかない）
    this.defending = false;
    if (this.level.defend && !aim && wantShift === 0) {
      const turn = this.turnAhead(here.s, DEFEND_LOOK);
      this.defending =
        Math.abs(turn) > ATTACK_TURN &&
        opponents.some((o) => {
          const gap = this.gapTo(o, here.s);
          return gap < -1 && gap > -DEFEND_GAP;
        });
      if (this.defending) wantShift = Math.sign(turn) * limit - this.line.offset[this.indexAt(here.s)] * this.level.line;
    }
    this.sideShift += (wantShift - this.sideShift) * Math.min(1, dt * 1.5);

    // --- ハンドル（先読みした点へ向かう） ---
    const lookahead = Math.max(6, Math.abs(v) * 0.5 + 4);
    const ti = this.indexAt(here.s + lookahead);
    const tyaw = course.pointAt(ti * this.line.step).yaw;
    let tx = this.lineX[ti] + Math.cos(tyaw) * this.sideShift;
    let tz = this.lineZ[ti] - Math.sin(tyaw) * this.sideShift;
    // 道路の外へは出ない
    const tp = course.project(tx, tz, { s: ti * this.line.step });
    if (Math.abs(tp.offset) > limit) {
      const fix = tp.offset - Math.sign(tp.offset) * limit;
      tx -= Math.cos(tyaw) * fix;
      tz += Math.sin(tyaw) * fix;
    }
    if (aim) {
      const a = course.pointAt(this.clampS(aim.s));
      tx = a.x + Math.cos(a.yaw) * aim.offset;
      tz = a.z - Math.sin(a.yaw) * aim.offset;
    }
    const dx = tx - car.x;
    const dz = tz - car.z;
    const forward = dx * sin + dz * cos;
    const left = dx * cos - dz * sin;
    const dist = Math.hypot(dx, dz);
    const alpha = Math.atan2(left, forward);
    const steerAngle = Math.atan((2 * p.wheelBase * Math.sin(alpha)) / Math.max(1, dist));
    const steer = Math.max(-1, Math.min(1, steerAngle / steerLimitAt(Math.max(1, v), p)));

    // --- アクセル・ブレーキ ---
    let target = this.targetSpeed(here.s, Math.max(4, v * 0.25)) * this.pace;
    // 抜くためにラインから横へずれているときは、コーナーが内側ほどきつくなる分だけ速さを抑える
    if (Math.abs(this.sideShift) > 0.3) {
      let k = 0;
      for (let d = 0; d <= Math.max(10, v * 1.5); d += this.line.step) k = Math.max(k, Math.abs(this.line.curvature[this.indexAt(here.s + d)]));
      target *= Math.sqrt(Math.max(0.5, 1 - k * Math.abs(this.sideShift)));
    }
    target = aim ? aim.speed : Math.min(target, follow);
    // 向かう点へ曲がりきれない速さなら落とす（ラインから外れて膨らみ始めたとき）
    const bend = Math.abs(2 * Math.sin(alpha)) / Math.max(1, dist);
    if (!aim && bend > 1e-3) target = Math.min(target, Math.sqrt(lateralAccelAt(v, p) / bend));
    // 大きく向きがずれているとき（スピン後など）はゆっくり戻る
    if (Math.abs(alpha) > 1.2) target = Math.min(target, 8);
    const err = target - v;
    let throttle = 0;
    let brake = 0;
    if (err > 0) {
      // 速度を保つのに必要な分（空気抵抗に見合うアクセル）に、足りない分を上乗せする。
      // 計画の速さは全開で加速したときの速さなので、少しでも足りなければすぐ全開にする（遅れると取り戻せない）
      const hold = (p.dragCoef * v * v) / Math.max(0.5, driveAccelAt(v, p));
      throttle = Math.min(1, hold + err * 4);
    } else if (err < -0.4) {
      brake = Math.min(1, -err * 0.35);
    }
    this.lastSteer = steer;
    return { throttle, brake, steer };
  }
}
