import type * as THREE from 'three';
import { type NpcLevel, NpcDriver, type Opponent, type RoughHit, type RoughStyle } from '../race/npcDriver';
import { buildRacingLine } from '../race/racingLine';
import { TimeAttack } from '../race/timeAttack';
import { CarMesh, type CarStyle } from '../render/carMesh';
import type { Car, CarSnapshot, Spawn } from '../sim/car';
import { type DriverInput, NEUTRAL_INPUT, type VehicleParams } from '../sim/vehicle';
import { FallRecovery } from './fall';
import type { LitCar } from './headlights';
import type { Level } from './level';
import { PLAYER_COLORS, createLabel } from './remoteCars';

const NPC_NAMES = ['ハヤテ', 'カエデ', 'ツバサ', 'ミドリ', 'ソラ'];
/** 同じ強さの NPC どうしでも差がつくよう、グリップにかける係数 */
const VARIATIONS = [1, 0.985, 0.97, 0.96, 0.95];
/** ゴールした NPC は、この割合の速さで流す（コース上で止まって邪魔にならないように） */
const COOL_DOWN_PACE = 0.55;

export interface Npc {
  name: string;
  color: number;
  car: Car;
  mesh: CarMesh;
  driver: NpcDriver;
  /** 周回とタイムの計測（プレイヤーと同じ仕組み） */
  timer: TimeAttack;
  prev: CarSnapshot;
  curr: CarSnapshot;
  /** 峠で道路から落ちたとき */
  fall: FallRecovery;
  /** 最後に車へ与えた操作（リプレイに記録する） */
  input: DriverInput;
  /** 車の id（リプレイに記録する。わからなければ空） */
  carId: string;
}

/** 前方 (sin, cos)・左 (cos, -sin) の速度を足して、地面に対する速度にする */
export function velocityOf(s: CarSnapshot): { vx: number; vz: number } {
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  return { vx: sin * s.forwardSpeed + cos * s.lateralSpeed, vz: cos * s.forwardSpeed - sin * s.lateralSpeed };
}

function lerpSnap(a: CarSnapshot, b: CarSnapshot, t: number): CarSnapshot {
  let dyaw = b.yaw - a.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return { ...b, x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, yaw: a.yaw + dyaw * t };
}

/** NPC 1台の設定 */
export interface NpcEntry {
  name: string;
  color: number;
  level: NpcLevel;
  params: VehicleParams;
  style?: CarStyle;
  /** 車の id（VEHICLE_PRESETS。リプレイでその車の形にする） */
  carId?: string;
  /** 同じ強さの NPC どうしでも差がつくよう、グリップにかける係数 */
  variation: number;
  /** ラフプレーでプレイヤーにぶつけてくるなら、そのやり方 */
  rough?: RoughStyle | null;
}

/**
 * NPC 対戦の NPC たち（同じ強さ・同じ車で、名前と色だけ違う）。
 * 並び順がスタートの位置になるので、毎回ばらばらに混ぜる（random は 0 以上 1 未満を返す関数）
 */
export function npcEntries(count: number, level: NpcLevel, params: VehicleParams, style?: CarStyle, random = Math.random): NpcEntry[] {
  const entries = Array.from({ length: count }, (_, i) => ({
    name: NPC_NAMES[i % NPC_NAMES.length],
    color: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length],
    level,
    params,
    style,
    variation: VARIATIONS[i % VARIATIONS.length],
  }));
  // Fisher–Yates
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries;
}

/** NPC 対戦で一緒に走る NPC たち。物理ワールドに車を置き、毎ステップ運転させる */
export class NpcField {
  readonly npcs: Npc[] = [];
  /** ライトをつけて走るか */
  private lightsOn = false;

  constructor(
    private readonly level: Level,
    scene: THREE.Scene,
    entries: readonly NpcEntry[],
    totalLaps: number,
    grid: Spawn[],
  ) {
    const course = level.course!;
    const line = buildRacingLine(course);
    const gradient = level.hasSlopes ? (x: number, z: number, s: number) => level.slopeAt(x, z, s) : undefined;
    entries.forEach((entry, i) => {
      const { name, color, params } = entry;
      const car = level.createCar(grid[i]);
      car.params = { ...params };
      const mesh = new CarMesh(color, entry.style);
      mesh.root.add(createLabel(name));
      scene.add(mesh.root);
      const snap = car.snapshot();
      const driver = new NpcDriver(line, params, entry.level, entry.variation, gradient);
      driver.rough = entry.rough ?? null;
      this.npcs.push({
        name,
        color,
        car,
        mesh,
        driver,
        timer: new TimeAttack(course, totalLaps, true),
        prev: snap,
        curr: snap,
        fall: new FallRecovery(),
        input: { ...NEUTRAL_INPUT },
        carId: entry.carId ?? '',
      });
    });
  }

  /** スタートの合図（プレイヤーと同時にカウントダウンを始める） */
  begin(): void {
    for (const n of this.npcs) n.timer.begin();
  }

  /** 物理ステップの前に呼ぶ。others はプレイヤーなど NPC 以外の車（ラフプレーの NPC は others[0] を狙う） */
  applyInputs(dt: number, canDrive: boolean, others: readonly CarSnapshot[]): void {
    const all = [...this.npcs.map((n) => n.curr), ...others];
    this.npcs.forEach((n, i) => {
      if (!canDrive || n.fall.falling) {
        n.input = { ...NEUTRAL_INPUT };
        n.car.applyInput(NEUTRAL_INPUT, dt);
        return;
      }
      const opponents: Opponent[] = all.filter((_, j) => j !== i).map((s) => ({ x: s.x, z: s.z, ...velocityOf(s) }));
      n.driver.pace = n.timer.phase === 'finished' ? COOL_DOWN_PACE : 1;
      const mark = n.driver.rough && others[0] ? { x: others[0].x, z: others[0].z, ...velocityOf(others[0]) } : undefined;
      n.input = n.driver.update(dt, n.curr, opponents, mark);
      n.car.applyInput(n.input, dt);
    });
  }

  /** ラフプレーで当てられたときの力（others[0] の車に Car.bump で与える）。無ければ null */
  takeHit(): RoughHit | null {
    for (const n of this.npcs) {
      const hit = n.driver.takeHit();
      if (hit) return hit;
    }
    return null;
  }

  /** 物理ステップの後に呼ぶ */
  afterStep(dt: number): void {
    for (const n of this.npcs) {
      n.prev = n.curr;
      n.curr = n.car.snapshot();
      if (n.fall.update(dt, this.level, n.car, n.curr) === 'recovered') n.prev = n.curr = n.car.snapshot();
      n.timer.update(dt, { x: n.curr.x, z: n.curr.z, ...velocityOf(n.curr) });
      n.timer.drainEvents();
    }
  }

  render(alpha: number): void {
    for (const n of this.npcs) {
      const s = this.level.ground(lerpSnap(n.prev, n.curr, alpha));
      n.mesh.update({ ...s, y: s.y - n.fall.drop });
    }
  }

  /** 描画するか（リプレイを見ている間は隠す） */
  setVisible(on: boolean): void {
    for (const n of this.npcs) n.mesh.root.visible = on;
  }

  /** ライトをつける・消す */
  setLights(on: boolean): void {
    this.lightsOn = on;
    for (const n of this.npcs) n.mesh.setLights(on);
  }

  /** 車と、そのライトの状態（render の後に呼ぶ） */
  litCars(): LitCar[] {
    return this.npcs.map((n) => ({ x: n.mesh.root.position.x, z: n.mesh.root.position.z, lit: this.lightsOn, root: n.mesh.root }));
  }

  dispose(): void {
    for (const n of this.npcs) {
      n.mesh.dispose();
      try {
        n.car.dispose();
      } catch {
        // マップ切り替えでワールドごと破棄済み
      }
    }
    this.npcs.length = 0;
  }
}

export interface Standing {
  name: string;
  color: number;
  isPlayer: boolean;
  /** ゴールしていればタイム */
  total: number | null;
  /** 走った周回の数 */
  laps: number;
}

/**
 * 順位を決める。ゴールした車はタイム順、まだ走っている車はコースを進んだ距離の順。
 */
export function rankEntrants(
  entrants: { name: string; color: number; isPlayer: boolean; timer: TimeAttack; x: number; z: number }[],
): Standing[] {
  const scored = entrants.map((e) => ({
    e,
    total: e.timer.phase === 'finished' ? e.timer.time : null,
    distance: e.timer.distance(e.x, e.z),
  }));
  scored.sort((a, b) => {
    if (a.total !== null && b.total !== null) return a.total - b.total;
    if (a.total !== null) return -1;
    if (b.total !== null) return 1;
    return b.distance - a.distance;
  });
  return scored.map(({ e, total }) => ({ name: e.name, color: e.color, isPlayer: e.isPlayer, total, laps: e.timer.laps.length }));
}
