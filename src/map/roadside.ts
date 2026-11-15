import { FLAG_BLIND, FLAG_BRIDGE, FLAG_GUTTER, FLAG_NEW, FLAG_TUNNEL, GUTTER_WIDTH, PointGrid, type RoadModel } from './road';
import { tileHash } from './obstacles';
import { type RoadCuts, cutAt } from './roadCuts';

/**
 * 峠の道ばたの小物（見た目だけで、ぶつからない）の置き場所。
 * - 視線誘導標（delineator）: 白い細いポールの上にオレンジの反射板。カーブの外側に細かく、直線はまばらに
 * - 矢印板（chevron）: きついカーブの外側に、曲がる向きの矢印の板を並べる
 * - カーブミラー（mirror）: 見通しの悪いきついカーブの外側に 1 本
 */
export type RoadsideKind = 'delineator' | 'chevron' | 'mirror';

export interface RoadsideProp {
  kind: RoadsideKind;
  x: number;
  z: number;
  /** 根元の高さ（道路の高さ）[m] */
  y: number;
  /** 正面（板・鏡の表）が向く向き（+Z から +X へ回る角度。来る車のほうを向く） */
  yaw: number;
  /** 道路のどちら側か（左 +1・右 -1） */
  side: number;
  /** 矢印板の矢印の向き（左へ曲がる +1・右へ -1） */
  turn: number;
}

/** 矢印板を置く、きついカーブの曲率 [1/m]（半径 45m より小さい） */
export const CHEVRON_CURVATURE = 1 / 45;
/** 視線誘導標をカーブの間隔で置く曲率（半径 150m より小さい） */
const DELINEATOR_CURVATURE = 1 / 150;
/** 道路の端からの距離 [m] */
const OFFSET: Record<RoadsideKind, number> = { delineator: 0.6, chevron: 1.0, mirror: 1.3 };

/** 道路の点 i で、左右のどちらがカーブの外側か（左カーブなら右 -1） */
const outside = (road: RoadModel, i: number) => (road.curvature[i] > 0 ? -1 : 1);

export function roadsideProps(road: RoadModel, cuts: RoadCuts | null): RoadsideProp[] {
  if (road.spec.scenery !== 'touge') return [];
  const out: RoadsideProp[] = [];
  const grid = new PointGrid(road.x, road.z);
  const near: number[] = [];
  const apart = Math.round(40 / road.step);
  /** (x, z) が、道路に沿って離れた別の所の路面や路肩にかからないか */
  const clear = (x: number, z: number, i: number) => {
    near.length = 0;
    grid.near(x, z, 20, near);
    for (const k of near) {
      let di = Math.abs(k - i);
      if (road.closed) di = Math.min(di, road.count - di);
      if (di < apart) continue;
      if (Math.hypot(x - road.x[k], z - road.z[k]) < road.width[k] / 2 + 1.5) return false;
    }
    const t = road.turnaround;
    return !(t && Math.hypot(x - t.cx, z - t.cz) < t.plaza + 2);
  };
  /** 置けない所: 橋・トンネル（とその出入り口）、山側の岩の崖の面 */
  const blocked = (i: number, side: number) => {
    const margin = Math.round(10 / road.step);
    for (const d of [-margin, 0, margin]) {
      const k = road.closed ? (i + d + road.count) % road.count : Math.min(road.count - 1, Math.max(0, i + d));
      if (road.flags[k] & (FLAG_BRIDGE | FLAG_TUNNEL)) return true;
    }
    return cuts !== null && cutAt(cuts, i, side) > 0.3;
  };
  const place = (kind: RoadsideKind, i: number, side: number, turn = 0) => {
    if (blocked(i, side)) return;
    // ガードレールのある新しい道は、ガードレールの外に立てる
    const rail = road.flags[i] & FLAG_NEW ? 0.6 : 0;
    const off = side * (road.width[i] / 2 + OFFSET[kind] + rail);
    const yaw = road.yaw[i];
    const x = road.x[i] + Math.cos(yaw) * off;
    const z = road.z[i] - Math.sin(yaw) * off;
    if (!clear(x, z, i)) return;
    // 来る車のほう（進む向きの反対）を向き、少しだけ道路の内側へ向ける
    out.push({ kind, x, z, y: road.h[i], yaw: yaw + Math.PI + side * 0.15, side, turn });
  };

  // きついカーブ: 外側に矢印板を並べ、見通しが悪ければカーブミラーを立てる
  const sharp = (i: number) => Math.abs(road.curvature[i]) > CHEVRON_CURVATURE;
  for (let i = 0; i < road.count; ) {
    if (!sharp(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < road.count && sharp(j + 1) && Math.sign(road.curvature[j + 1]) === Math.sign(road.curvature[i])) j++;
    const side = outside(road, i);
    const turn = road.curvature[i] > 0 ? 1 : -1;
    const length = (j - i) * road.step;
    const count = Math.max(3, Math.min(7, Math.round(length / 9) + 1));
    for (let n = 0; n < count; n++) place('chevron', Math.round(i + ((j - i) * (n + 0.5)) / count), side, turn);
    if ((road.flags[Math.round((i + j) / 2)] & FLAG_BLIND) !== 0 || length > 25) {
      // ミラーはカーブの真ん中の少し手前（矢印板と重ならないよう、さらに外側）
      place('mirror', Math.round(i + (j - i) * 0.4), side);
    }
    i = j + 1;
  }

  // 視線誘導標: カーブの外側は 12m ごと、直線は両側に 48m ごと。ガードレールの所は反射板があるので置かない
  const every = Math.round(12 / road.step);
  for (let i = 0, n = 0; i < road.count; i += every, n++) {
    if (road.flags[i] & FLAG_NEW || sharp(i)) continue;
    if (Math.abs(road.curvature[i]) > DELINEATOR_CURVATURE) place('delineator', i, outside(road, i));
    else if (n % 4 === 0) for (const side of [-1, 1]) place('delineator', i, side);
  }
  return out;
}

/** 道ばたの下草: 草の株（grass）と低い茂み（shrub） */
export interface Undergrowth {
  kind: 'grass' | 'shrub';
  x: number;
  z: number;
  /** 高さ（茂みは大きさ）[m] */
  size: number;
  yaw: number;
  /** 色のばらつき（0〜1） */
  tone: number;
}

/**
 * 峠の道路の両脇の下草。路肩から数 m の所に草の株を、少し離れて茂みを置く。
 * 橋・トンネル・山側の岩の崖・他の道路の上・U ターンの広場・ヘアピンの内側の近道の帯（avoid）には置かない
 */
export function undergrowth(road: RoadModel, cuts: RoadCuts | null, avoid: (x: number, z: number) => boolean = () => false): Undergrowth[] {
  if (road.spec.scenery !== 'touge') return [];
  const out: Undergrowth[] = [];
  const grid = new PointGrid(road.x, road.z);
  const near: number[] = [];
  const turn = road.turnaround;
  const clear = (x: number, z: number) => {
    near.length = 0;
    grid.near(x, z, 20, near);
    for (const k of near) {
      const d = Math.hypot(x - road.x[k], z - road.z[k]);
      if (d < road.width[k] / 2 + 0.5) return false;
      if (road.flags[k] & (FLAG_BRIDGE | FLAG_TUNNEL) && d < road.width[k] / 2 + 8) return false;
    }
    if (turn && Math.hypot(x - turn.cx, z - turn.cz) < turn.plaza + 1) return false;
    return !avoid(x, z);
  };
  const step = Math.max(1, Math.round(1.3 / road.step));
  for (let i = 0; i < road.count; i += step) {
    if (road.flags[i] & (FLAG_BRIDGE | FLAG_TUNNEL)) continue;
    const yaw = road.yaw[i];
    for (const side of [-1, 1]) {
      if (cuts && cutAt(cuts, i, side) > 0.3) continue;
      // 側溝やガードレールのある所は、その外から
      const start = 0.6 + (road.flags[i] & FLAG_GUTTER ? GUTTER_WIDTH : 0) + (road.flags[i] & FLAG_NEW ? 0.8 : 0);
      for (let r = 0; r < 3; r++) {
        const h = (a: number) => tileHash(i, side * 7 + r * 3 + a, 101);
        const shrub = r === 2;
        if (h(0) > (shrub ? 0.35 : 0.8)) continue;
        const off = side * (road.width[i] / 2 + start + (shrub ? 2 + h(1) * 4 : r * 1.4 + h(1) * 1.6));
        const along = (h(2) - 0.5) * 1.3;
        const x = road.x[i] + Math.cos(yaw) * off + Math.sin(yaw) * along;
        const z = road.z[i] - Math.sin(yaw) * off + Math.cos(yaw) * along;
        if (!clear(x, z)) continue;
        out.push({ kind: shrub ? 'shrub' : 'grass', x, z, size: shrub ? 0.8 + h(3) * 1.2 : 0.35 + h(3) * 0.45, yaw: h(4) * Math.PI * 2, tone: h(5) });
      }
    }
  }
  return out;
}

