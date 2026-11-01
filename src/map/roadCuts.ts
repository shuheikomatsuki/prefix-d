import { FLAG_BLIND, FLAG_BRIDGE, FLAG_TUNNEL, PointGrid, type RoadModel } from './road';

/** 山側の崖の高さを調べるときに、横に探す距離 [m]（すぐ上を通る別の道路まで） */
const SEARCH = 55;
/** 道路に沿って前後これより近い所だけを、横にある道路とみなす [m] */
const ALONG = 12;
/** 別の道路が少なくともこれだけ高ければ、その側を山側（崖）にする [m] */
const MIN_RISE = 3;
/** 崖の上の端を、上の道路の高さよりこれだけ低くする [m] */
const TOP_MARGIN = 0.4;
/** 崖の高さの上限 [m] */
const MAX_CUT = 25;
/** 崖の高さを道路に沿ってならす幅 [m]（区間の端では高さを 0 へ下げる） */
const SMOOTH = 8;
/** 崖の下の端（岩の壁）の、道路の端からの距離 [m] */
export const CUT_FOOT = 1;
/** 崖が上の端まで上がりきる、道路の端からの距離 [m] */
export const CUT_TOP = 6;

/**
 * 見通しの悪い区間（FLAG_BLIND）の、道路の両側の岩の崖（山を切り開いた切り通し）の高さ [m]。
 * すぐ横を高い所で別の道路が通る側（つづら折りの一つ前・一つ後の区間）を山側とし、その道路の高さの少し下まで
 * 崖を立てる。left / right は道路の点ごとの高さで、崖のない所は 0
 */
export interface RoadCuts {
  left: Float32Array;
  right: Float32Array;
}

export function buildRoadCuts(road: RoadModel): RoadCuts {
  const n = road.count;
  const raw = { left: new Float32Array(n), right: new Float32Array(n) };
  const grid = new PointGrid(road.x, road.z);
  const near: number[] = [];
  const apart = Math.round(60 / road.step);
  const usable = (i: number) => (road.flags[i] & FLAG_BLIND) !== 0 && (road.flags[i] & (FLAG_BRIDGE | FLAG_TUNNEL)) === 0;
  for (let i = 0; i < n; i++) {
    if (!usable(i)) continue;
    const fx = Math.sin(road.yaw[i]);
    const fz = Math.cos(road.yaw[i]);
    near.length = 0;
    grid.near(road.x[i], road.z[i], SEARCH, near);
    for (const k of near) {
      let di = Math.abs(k - i);
      if (road.closed) di = Math.min(di, n - di);
      if (di < apart) continue;
      const dx = road.x[k] - road.x[i];
      const dz = road.z[k] - road.z[i];
      if (Math.abs(dx * fx + dz * fz) > ALONG) continue;
      // 左 = (cos yaw, -sin yaw)
      const lateral = dx * fz - dz * fx;
      if (Math.abs(lateral) > SEARCH) continue;
      const rise = road.h[k] - road.h[i];
      if (rise < MIN_RISE) continue;
      const side = lateral > 0 ? raw.left : raw.right;
      side[i] = Math.max(side[i], Math.min(MAX_CUT, rise - TOP_MARGIN));
    }
  }
  // 道路に沿ってならす（崖の高さが急に変わらないよう、前後の平均。区間の外は 0 として平均する）
  const k = Math.round(SMOOTH / road.step);
  const smooth = (a: Float32Array) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (!usable(i)) continue;
      let sum = 0;
      for (let j = i - k; j <= i + k; j++) {
        const jj = road.closed ? (j + n) % n : j;
        if (jj >= 0 && jj < n && usable(jj)) sum += a[jj];
      }
      out[i] = sum / (2 * k + 1);
    }
    return out;
  };
  return { left: smooth(raw.left), right: smooth(raw.right) };
}

/** 道路の点 i の side（1 = 左、-1 = 右）の崖の高さ [m] */
export function cutAt(cuts: RoadCuts, i: number, side: number): number {
  return side > 0 ? cuts.left[i] : cuts.right[i];
}
