import { FLAG_BRIDGE, type RoadModel } from './road';
import { CUT_FOOT, CUT_TOP, buildRoadCuts, cutAt } from './roadCuts';
import { CLIFF_START } from './terrain';

/** 地形の格子の間隔 [m] */
const GRID_STEP = 4;
/** 道路の外側にも地形を広げる幅 [m] */
const MARGIN = 200;
const CLIFF_WIDTH = 6;
const CLIFF_DEPTH = 10;
/** 道路の中心線からこれより離れた所は、周りの道路の高さの平均の崖の下 [m] */
const REACH = 56;
/** 粗い格子（周りの高さの平均）の間隔（GRID_STEP の何倍か） */
const COARSE = 4;
/** 地形を求めるのに使う道路の点の間隔 [m] */
const POINT_STEP = 2;
/** 谷の斜面の勾配（谷の底から横へ 1m 離れるごとに上がる高さ） */
const VALLEY_SLOPE = 0.7;

const smoothstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** 中心線で描く道路の峠の、見た目の地面 */
export interface RoadGround {
  grid: { minX: number; minZ: number; step: number; nx: number; nz: number; ground: Float32Array };
  /** 地面の高さ [m] */
  groundAt(x: number, z: number): number;
  /** 谷（大きな橋の下）の川: 中心・向き・長さ・水面の高さ */
  rivers: { x: number; z: number; yaw: number; length: number; y: number }[];
}

/**
 * 峠の地面を作る。道路の上は道路の高さ（少し下）、道路の脇は路肩の先で崖になり、離れた所は周りの道路の高さの
 * 平均につながる（タイルの峠の地形 src/map/terrain.ts と同じ考え方）。
 * 橋の区間は地面を決めず、谷の深さ（valley）を指定した橋の下は、橋の高さから谷の深さだけ下った V 字の谷にする
 */
export function buildRoadGround(
  road: RoadModel,
  valleys: readonly { from: number; to: number; depth: number }[],
  shortcutAt?: (x: number, z: number, lowRamp: number) => number | null,
): RoadGround {
  // 地面を決める道路の点（橋の上は除く）と、橋の点
  const gx: number[] = [];
  const gz: number[] = [];
  const gh: number[] = [];
  const gw: number[] = [];
  /** 地面を決める点の、道路の点の番号（U ターンの広場の点は -1） */
  const gi: number[] = [];
  const every = Math.round(POINT_STEP / road.step);
  for (let i = 0; i < road.count; i += every) {
    if (road.flags[i] & FLAG_BRIDGE) continue;
    gx.push(road.x[i]);
    gz.push(road.z[i]);
    gh.push(road.h[i]);
    gw.push(road.width[i] / 2);
    gi.push(i);
  }
  const turn = road.turnaround;
  if (turn) {
    // U ターンの広場は平ら
    const h = road.h[road.count - 1];
    for (let a = 0; a < 24; a++) {
      for (const r of [0, turn.plaza * 0.5]) {
        gx.push(turn.cx + Math.cos((a / 24) * 2 * Math.PI) * r);
        gz.push(turn.cz + Math.sin((a / 24) * 2 * Math.PI) * r);
        gh.push(h);
        gw.push(turn.plaza * (r === 0 ? 1 : 0.5));
        gi.push(-1);
      }
    }
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < road.count; i++) {
    minX = Math.min(minX, road.x[i]);
    maxX = Math.max(maxX, road.x[i]);
    minZ = Math.min(minZ, road.z[i]);
    maxZ = Math.max(maxZ, road.z[i]);
  }
  minX -= MARGIN;
  minZ -= MARGIN;
  const nx = Math.ceil((maxX + MARGIN - minX) / GRID_STEP) + 1;
  const nz = Math.ceil((maxZ + MARGIN - minZ) / GRID_STEP) + 1;
  const ground = new Float32Array(nx * nz);

  // 周りの道路の高さの重み付き平均（なめらかなので粗い格子で求めて補間する）
  const cnx = Math.ceil((nx - 1) / COARSE) + 1;
  const cnz = Math.ceil((nz - 1) / COARSE) + 1;
  const average = new Float64Array(cnx * cnz);
  for (let cj = 0; cj < cnz; cj++) {
    const z = minZ + cj * COARSE * GRID_STEP;
    for (let ci = 0; ci < cnx; ci++) {
      const x = minX + ci * COARSE * GRID_STEP;
      let wSum = 0;
      let hSum = 0;
      for (let k = 0; k < gx.length; k += 4) {
        const d2 = (x - gx[k]) ** 2 + (z - gz[k]) ** 2;
        const w = 1 / ((d2 + 25) * (d2 + 25));
        wSum += w;
        hSum += w * gh[k];
      }
      average[cj * cnx + ci] = hSum / wSum;
    }
  }
  const averageAt = (i: number, j: number) => {
    const fi = i / COARSE;
    const fj = j / COARSE;
    const ci = Math.min(cnx - 2, Math.floor(fi));
    const cj = Math.min(cnz - 2, Math.floor(fj));
    const u = fi - ci;
    const v = fj - cj;
    const a = average[cj * cnx + ci];
    const b = average[cj * cnx + ci + 1];
    const c = average[(cj + 1) * cnx + ci];
    const e = average[(cj + 1) * cnx + ci + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };

  // 見通しの悪い区間の山側の岩の崖
  const cuts = buildRoadCuts(road);

  // それぞれの格子点にいちばん近い道路の点（道路の点から周りの格子点へ書き込む）。
  // 比べるのは「中心からの距離 − 道幅の半分」（広場のような広い点ほど近い）。道路の上では負になる
  const nearestM = new Float64Array(nx * nz).fill(Infinity);
  const nearestK = new Int32Array(nx * nz).fill(-1);
  const reach = Math.ceil(REACH / GRID_STEP);
  for (let k = 0; k < gx.length; k++) {
    const ci = Math.round((gx[k] - minX) / GRID_STEP);
    const cj = Math.round((gz[k] - minZ) / GRID_STEP);
    for (let j = Math.max(0, cj - reach); j <= Math.min(nz - 1, cj + reach); j++) {
      const dz = minZ + j * GRID_STEP - gz[k];
      for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i++) {
        const dx = minX + i * GRID_STEP - gx[k];
        const m = Math.sqrt(dx * dx + dz * dz) - gw[k];
        const cell = j * nx + i;
        if (m < nearestM[cell]) {
          nearestM[cell] = m;
          nearestK[cell] = k;
        }
      }
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const cell = j * nx + i;
      const k = nearestK[cell];
      if (k < 0) {
        ground[cell] = averageAt(i, j) - CLIFF_DEPTH;
        continue;
      }
      // d は道路の端からの距離（道路の上は 0）
      const d = Math.max(0, nearestM[cell]);
      const t = smoothstep((d - 2) / 30);
      let h = gh[k] + (averageAt(i, j) - gh[k]) * t - CLIFF_DEPTH * smoothstep((d - CLIFF_START) / CLIFF_WIDTH);
      const ri = gi[k];
      if (ri >= 0) {
        // 山側の崖: 道路の端のすぐ外から切り立って上がり、上の端から先は平ら（上の道路との間の段）
        const yaw = road.yaw[ri];
        const lateral = (minX + i * GRID_STEP - gx[k]) * Math.cos(yaw) - (minZ + j * GRID_STEP - gz[k]) * Math.sin(yaw);
        const cut = cutAt(cuts, ri, lateral);
        if (cut > 0) h = Math.max(h, gh[k] + cut * smoothstep((d - CUT_FOOT) / (CUT_TOP - CUT_FOOT)));
      }
      ground[cell] = h - 0.25 * (1 - smoothstep(d / 3));
    }
  }

  // 大きな橋の下の谷: 橋の高さから depth だけ下った谷の底へ、V 字に下げる（道路の近くは下げない）
  const rivers: RoadGround['rivers'] = [];
  for (const v of valleys) {
    const i0 = road.indexAt(v.from);
    const i1 = road.indexAt(v.to);
    const span = v.to - v.from;
    let lowest = Infinity;
    for (let i = i0; i <= i1; i++) {
      const u = (i * road.step - v.from) / span;
      // 橋の両端では浅く、中ほどで深い
      const depth = v.depth * smoothstep(Math.min(u, 1 - u) / 0.3);
      const floor = road.h[i] - depth;
      lowest = Math.min(lowest, floor);
      const reachV = Math.ceil((depth / VALLEY_SLOPE + 10) / GRID_STEP);
      const ci = Math.round((road.x[i] - minX) / GRID_STEP);
      const cj = Math.round((road.z[i] - minZ) / GRID_STEP);
      for (let j = Math.max(0, cj - reachV); j <= Math.min(nz - 1, cj + reachV); j++) {
        for (let ii = Math.max(0, ci - reachV); ii <= Math.min(nx - 1, ci + reachV); ii++) {
          const cell = j * nx + ii;
          // 地面を決める道路のすぐ近く（橋のたもとの道路）は掘らない
          if (nearestK[cell] >= 0 && nearestM[cell] < 6) continue;
          const d = Math.hypot(minX + ii * GRID_STEP - road.x[i], minZ + j * GRID_STEP - road.z[i]);
          const y = floor + Math.max(0, d - 6) * VALLEY_SLOPE;
          if (y < ground[cell]) ground[cell] = y;
        }
      }
    }
    // 谷の底の川（橋と直角に流れる）
    const mid = road.indexAt((v.from + v.to) / 2);
    rivers.push({ x: road.x[mid], z: road.z[mid], yaw: road.yaw[mid] + Math.PI / 2, length: 600, y: lowest + 1.2 });
  }

  // 橋の床の下から地面が突き出さないよう、橋の真下は床より少し低くする（橋のたもと）
  for (let i = 0; i < road.count; i++) {
    if (!(road.flags[i] & FLAG_BRIDGE)) continue;
    const r = road.width[i] / 2 + 1.5;
    const reachB = Math.ceil(r / GRID_STEP);
    const ci = Math.round((road.x[i] - minX) / GRID_STEP);
    const cj = Math.round((road.z[i] - minZ) / GRID_STEP);
    for (let j = Math.max(0, cj - reachB); j <= Math.min(nz - 1, cj + reachB); j++) {
      for (let ii = Math.max(0, ci - reachB); ii <= Math.min(nx - 1, ci + reachB); ii++) {
        if (Math.hypot(minX + ii * GRID_STEP - road.x[i], minZ + j * GRID_STEP - road.z[i]) > r) continue;
        const cell = j * nx + ii;
        ground[cell] = Math.min(ground[cell], road.h[i] - 0.4);
      }
    }
  }

  // ヘアピンの内側の近道の帯は、帯の面の高さ（面の下に少し沈める）。下の道路との段差は格子 1 つ分だけ帯の側へずらす
  if (shortcutAt) {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const cut = shortcutAt(minX + i * GRID_STEP, minZ + j * GRID_STEP, GRID_STEP);
        if (cut !== null) ground[j * nx + i] = cut - 0.05;
      }
    }
  }

  const groundAt = (x: number, z: number) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - minX) / GRID_STEP));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - minZ) / GRID_STEP));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = ground[j * nx + i];
    const b = ground[j * nx + i + 1];
    const c = ground[(j + 1) * nx + i];
    const e = ground[(j + 1) * nx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
  };
  return { grid: { minX, minZ, step: GRID_STEP, nx, nz, ground }, groundAt, rivers };
}
