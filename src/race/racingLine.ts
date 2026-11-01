import { type VehicleParams, brakeGripShare, driveAccelAt, lateralAccelAt } from '../sim/vehicle';
import type { Course } from './course';

/** レーシングラインの点の間隔 [m] */
export const LINE_STEP = 2;
const GRAVITY = 9.81;

/**
 * NPC が走る理想のライン。コースの中心線を道幅の中で左右にずらし、カーブをできるだけゆるく通る。
 * offset[i] は中心線上の距離 s = i * step の点から左へのずれ [m]。
 */
export interface RacingLine {
  course: Course;
  step: number;
  /** 点の数（周回コースは一周分、一本道はゴールの先で止まる位置まで） */
  count: number;
  x: Float64Array;
  z: Float64Array;
  offset: Float64Array;
  /** ライン上の曲率 [1/m]（符号つき） */
  curvature: Float64Array;
}

/**
 * レーシングラインを作る。道幅から余白 margin を除いた範囲で、ラインの各点を「前後の点から見て
 * 曲がりが最も小さくなる位置」へ近づけることをくり返すと、アウト・イン・アウトの滑らかなラインになる。
 * 遠くの点どうしから順に（粗い間隔から細かい間隔へ）なめらかにすると、少ない回数で全体が整う。
 */
export function buildRacingLine(course: Course, margin = 1.6): RacingLine {
  const step = LINE_STEP;
  const closed = course.closed;
  // 一本道は、最後のタイルの中心（道路の端の手前）まで
  const end = closed ? course.length : course.end - course.map.def.tileSize / 2;
  const count = closed ? Math.round(end / step) : Math.floor(end / step) + 1;
  const ds = closed ? end / count : step;
  const cx = new Float64Array(count);
  const cz = new Float64Array(count);
  const nx = new Float64Array(count);
  const nz = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const p = course.pointAt(i * ds);
    cx[i] = p.x;
    cz[i] = p.z;
    // 左 = (cos yaw, -sin yaw)
    nx[i] = Math.cos(p.yaw);
    nz[i] = -Math.sin(p.yaw);
  }
  // 道幅は場所によって変わる（中心線で描く道路のマップ）
  const limit = Float64Array.from({ length: count }, (_, i) => Math.max(0, course.widthAt(i * ds) / 2 - margin));
  const offset = new Float64Array(count);
  const at = (i: number) => (closed ? ((i % count) + count) % count : Math.min(count - 1, Math.max(0, i)));

  for (const [k, iterations] of [
    [16, 100],
    [8, 150],
    [4, 200],
    [2, 200],
    [1, 150],
  ] as const) {
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < count; i++) {
        // 一本道の両端（スタートとゴールの先）は中央に固定する
        if (!closed && (i < 2 * k || i > count - 1 - 2 * k)) continue;
        // 曲率（2階差分）が最小になる位置: (-p[i-2k] + 4p[i-k] + 4p[i+k] - p[i+2k]) / 6
        const a2 = at(i - 2 * k);
        const a = at(i - k);
        const b = at(i + k);
        const b2 = at(i + 2 * k);
        const X = (j: number) => cx[j] + nx[j] * offset[j];
        const Z = (j: number) => cz[j] + nz[j] * offset[j];
        const mx = (-X(a2) + 4 * X(a) + 4 * X(b) - X(b2)) / 6;
        const mz = (-Z(a2) + 4 * Z(a) + 4 * Z(b) - Z(b2)) / 6;
        const px = cx[i] + nx[i] * offset[i];
        const pz = cz[i] + nz[i] * offset[i];
        const delta = (mx - px) * nx[i] + (mz - pz) * nz[i];
        offset[i] = Math.min(limit[i], Math.max(-limit[i], offset[i] + delta * 0.8));
      }
    }
  }

  const x = new Float64Array(count);
  const z = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    x[i] = cx[i] + nx[i] * offset[i];
    z[i] = cz[i] + nz[i] * offset[i];
  }
  const curvature = new Float64Array(count);
  const span = 3;
  for (let i = 0; i < count; i++) {
    const a = at(i - span);
    const b = at(i + span);
    curvature[i] = a === i || b === i ? 0 : signedCurvature(x[a], z[a], x[i], z[i], x[b], z[b]);
  }
  return { course, step: ds, count, x, z, offset, curvature };
}

/** 3点を通る円の曲率（左に曲がるとき正） */
function signedCurvature(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const bcx = cx - bx;
  const bcz = cz - bz;
  const acx = cx - ax;
  const acz = cz - az;
  // 上から見て反時計回り（左）を正にするため、外積の符号を (x, z) → 左手系で反転する
  const cross = abz * bcx - abx * bcz;
  const denom = Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(acx, acz);
  return denom > 1e-9 ? (2 * cross) / denom : 0;
}

export interface SpeedProfileOptions {
  /** 横方向の加速度の上限のうち使う割合（グリップの使い方） */
  grip: number;
  /** ブレーキの強さのうち使う割合 */
  brake: number;
  /** 坂道のマップなら勾配（上り坂で加速が鈍り、ブレーキが効きやすくなる）。s はその点のコース上の距離 */
  gradient?: (x: number, z: number, s: number) => { x: number; z: number };
}

/**
 * ラインの各点で出してよい速度 [m/s]。カーブの曲率で決まる上限から、
 * 手前でブレーキが間に合うよう（後ろ向き）、加速が追いつく範囲で（前向き）なめらかにする。
 */
export function buildSpeedProfile(line: RacingLine, p: VehicleParams, opts: SpeedProfileOptions): Float64Array {
  const { count, step, curvature } = line;
  const closed = line.course.closed;
  const v = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const k = Math.abs(curvature[i]);
    if (k <= 1e-6) {
      v[i] = p.maxForwardSpeed;
      continue;
    }
    // 横加速度の上限は速さで変わる（ダウンフォース）ので、何回か繰り返して釣り合う速さを求める
    let speed = Math.sqrt((p.maxLateralAccel * opts.grip) / k);
    for (let n = 0; n < 4; n++) speed = Math.sqrt((lateralAccelAt(speed, p) * opts.grip) / k);
    v[i] = Math.min(p.maxForwardSpeed, speed);
  }
  // 一本道はゴールの先で止まる
  if (!closed) v[count - 1] = 0;

  const grade = new Float64Array(count);
  if (opts.gradient) {
    for (let i = 0; i < count; i++) {
      const j = closed ? (i + 1) % count : Math.min(count - 1, i + 1);
      const h = Math.hypot(line.x[j] - line.x[i], line.z[j] - line.z[i]) || 1;
      const g = opts.gradient(line.x[i], line.z[i], i * step);
      grade[i] = (g.x * (line.x[j] - line.x[i]) + g.z * (line.z[j] - line.z[i])) / h;
    }
  }
  const accelAt = (speed: number, i: number) =>
    Math.max(0.3, driveAccelAt(speed, p) - p.dragCoef * speed * speed - GRAVITY * grade[i]);
  // カーブの途中では、曲がるのに使っているグリップの分だけブレーキが弱くなる（摩擦円）
  const brakeAt = (speed: number, i: number) => {
    const corner = (speed * speed * Math.abs(curvature[i])) / (lateralAccelAt(speed, p) * opts.grip);
    return Math.max(1, p.brakeDecel * opts.brake * brakeGripShare(corner) + p.dragCoef * speed * speed + GRAVITY * grade[i]);
  };

  // 周回コースは継ぎ目をまたぐので2周分まわす
  const passes = closed ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
    for (let n = count - 1; n >= 0; n--) {
      const i = n;
      const next = i + 1 < count ? i + 1 : closed ? 0 : -1;
      if (next < 0) continue;
      v[i] = Math.min(v[i], Math.sqrt(v[next] * v[next] + 2 * brakeAt(v[next], i) * step));
    }
  }
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < count; i++) {
      const prev = i > 0 ? i - 1 : closed ? count - 1 : -1;
      if (prev < 0) continue;
      v[i] = Math.min(v[i], Math.sqrt(v[prev] * v[prev] + 2 * accelAt(v[prev], prev) * step));
    }
  }
  return v;
}

/** ラインを v [m/s] の速度で走ったときの時間（周回コースは一周、一本道はゴールまで） */
export function profileTime(line: RacingLine, v: Float64Array): number {
  const lastIndex = line.course.closed ? line.count : Math.round(line.course.length / line.step);
  let t = 0;
  for (let i = 0; i < lastIndex; i++) {
    const a = v[i % line.count];
    const b = v[(i + 1) % line.count];
    t += line.step / Math.max(0.5, (a + b) / 2);
  }
  return t;
}
