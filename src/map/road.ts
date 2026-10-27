/**
 * 中心線で描く道路（タイルを使わないマップ）。
 *
 * 直線と円弧をつないで道路の形を決め、区間（piece）ごとに高さ・道幅・橋・トンネルなどを指定する。
 * タイルの道路と違って、半径の大きな円のカーブ、360° 以上曲がり続けるカーブ、道路が自分の上を越える
 * 立体交差を作れる。
 *
 * 物理（衝突）はタイルのマップと同じく平らなまま計算する。立体交差では、上の道路と下の道路の壁を
 * 別の層（layer）に分け、車はいまいる道路の層の壁とだけぶつかる（src/game/level.ts）。
 *
 * 座標: タイルのマップと同じく +X が東、+Z が南。ヨー角は前方 +Z を 0 とし、上から見て反時計回り（左）が正。
 */

/** 道路の1区間。straight か arc のどちらかを書く */
export interface RoadPiece {
  /** 直線の長さ [m] */
  straight?: number;
  /** 円弧: 半径 [m] と、曲がる角度 [度]（左が正、右が負。360 を超えてもよい） */
  arc?: { radius: number; turn: number };
  /** この区間の終わりの高さ [m]。書かない区間は、前後の書いた区間の間を一定の勾配でつなぐ */
  h?: number;
  /** この区間の道幅 [m]（書かなければ RoadSpec.width） */
  width?: number;
  /** 橋（谷や海の上。下に橋脚を立て、両側に欄干の壁を置く） */
  bridge?: boolean;
  /** 橋の下の谷の深さ [m]（峠の大きな橋。書かなければ谷を掘らない） */
  valley?: number;
  /** 吊り橋（主塔とケーブルのある白い橋）。直線の橋の区間に付ける */
  suspension?: boolean;
  /** トンネル（山の中。両側に壁、上に天井） */
  tunnel?: boolean;
  /** 路面が荒れていて、細かく波打つ（車が少し跳ねる） */
  bumpy?: boolean;
  /**
   * カーブの内側の路肩に側溝がある（円弧の区間に付ける）。内側のタイヤを溝に落とすと、溝の壁に引っかかって
   * 外へ逃げずに速く曲がれる（溝落とし。src/game/track.ts の gutterAt）
   */
  gutter?: boolean;
  /** 見た目: 拡幅工事を終えた新しい舗装（黒く、白線がくっきり）か、古い狭い道（灰色で白線なし） */
  surface?: 'new' | 'old';
}

export interface RoadSpec {
  pieces: readonly RoadPiece[];
  /** 道路の始まりの位置と向き（省略時は原点から東向き） */
  origin?: { x: number; z: number; yaw: number };
  /** 道路の始まりの高さ [m] */
  startHeight?: number;
  /** ふつうの道幅 [m] */
  width: number;
  /** 一周して始まりに戻る周回の道路か（終わりが始まりにつながっていること） */
  closed?: boolean;
  /**
   * 道路の終わりで U ターンして、同じ道を戻ってくるコースにする（峠の往復のバトル）。
   * 終わりには丸い広場があり、コースは半径 radius [m] の電球の形の輪を回って折り返す
   */
  turnaround?: { radius: number };
  /** スタートラインの位置（道路の始まりからの距離 [m]）。往復のコースは、戻ってきた同じ位置がゴール */
  start: number;
  /** 周りの景色: 峠（山・谷・森）、首都高（高架の下の街と海）、サーキット（平らな芝生。道路の外に退避帯と壁） */
  scenery: 'touge' | 'highway' | 'circuit';
  /** サーキット: 道路の端から壁までの退避帯の幅 [m] */
  runoff?: number;
  /** 首都高: 道路の下の地面（街・海）の高さ [m] と車線の数 */
  highway?: { ground: number; lanes: number };
  /** 首都高: 海の範囲（長方形の [minX, minZ, maxX, maxZ]）。ここには建物を置かず、水面を描く */
  sea?: readonly (readonly [number, number, number, number])[];
}

/** 中心線の点の間隔 [m] */
export const ROAD_STEP = 1;
/** 高さの変化をなめらかにする幅 [m]（この幅で平均して、勾配の折れ目を丸める） */
const HEIGHT_SMOOTH = 60;
/** 道幅の変化をなめらかにする幅 [m] */
const WIDTH_SMOOTH = 30;
/** 荒れた路面の波の高さ [m] */
export const BUMP_AMPLITUDE = 0.045;
/**
 * 立体交差を見つける: 道路に沿って CROSS_APART [m] 以上離れた2点が、平面で道幅の半分ずつ＋ CROSS_MARGIN [m]
 * より近く、高さが CROSS_CLEARANCE [m] 以上違えば交差。交差の前後 LAYER_EXTEND [m] を上・下の層にする
 */
const CROSS_APART = 60;
const CROSS_MARGIN = 6;
const CROSS_CLEARANCE = 4;
const LAYER_EXTEND = 30;

export const FLAG_BRIDGE = 1;
export const FLAG_TUNNEL = 2;
export const FLAG_BUMPY = 4;
export const FLAG_SUSPENSION = 8;
export const FLAG_NEW = 16;
export const FLAG_OLD = 32;
export const FLAG_GUTTER = 64;
/** カーブの内側の側溝の幅 [m]（道路の端から外へ） */
export const GUTTER_WIDTH = 0.5;

/** 立体交差の層。NONE は交差のない所（どちらの層の壁ともぶつかる） */
export const LAYER_NONE = 0;
export const LAYER_LOWER = 1;
export const LAYER_UPPER = 2;

/** U ターンの広場 */
export interface Turnaround {
  /** 道路の終わり（輪の入口と出口） */
  x: number;
  z: number;
  yaw: number;
  radius: number;
  /** 広場（丸い舗装）の中心と半径 */
  cx: number;
  cz: number;
  plaza: number;
  /** 輪の中心線の点（入口から出口まで ROAD_STEP ごと） */
  loop: { x: number; z: number; yaw: number; curvature: number }[];
  /** 輪の長さ [m] */
  length: number;
}

export interface RoadModel {
  spec: RoadSpec;
  closed: boolean;
  step: number;
  /** 中心線の点の数。周回は count * step = length、そうでなければ (count - 1) * step = length（step は ROAD_STEP に近い値） */
  count: number;
  length: number;
  x: Float64Array;
  z: Float64Array;
  yaw: Float64Array;
  /** 曲率 [1/m]（左カーブが正） */
  curvature: Float64Array;
  /** 路面の高さ [m] */
  h: Float64Array;
  width: Float64Array;
  /** 荒れた路面の強さ（0..1、区間の境目はなめらかに変わる） */
  bump: Float32Array;
  flags: Uint8Array;
  layer: Uint8Array;
  /** 区間の始まりの距離 [m]（pieces と同じ並び。最後に全長） */
  pieceStart: number[];
  turnaround: Turnaround | null;
  /** 距離 s の点の番号（周回は一周で戻る。そうでなければ端に収める） */
  indexAt(s: number): number;
  heightAt(s: number): number;
  /** 進む向きに 1m 進んだときに上がる高さ */
  gradeAt(s: number): number;
  widthAt(s: number): number;
  hasFlag(s: number, flag: number): boolean;
}

interface PieceState {
  x: number;
  z: number;
  yaw: number;
  s: number;
  length: number;
  curvature: number;
}

/** 曲率 k で u [m] 進んだ点（k = 0 は直線） */
function advance(x: number, z: number, yaw: number, k: number, u: number): { x: number; z: number; yaw: number } {
  if (Math.abs(k) < 1e-9) return { x: x + Math.sin(yaw) * u, z: z + Math.cos(yaw) * u, yaw };
  const yaw1 = yaw + k * u;
  // x' = sin(yaw), z' = cos(yaw), yaw' = k を積分する
  return { x: x + (Math.cos(yaw) - Math.cos(yaw1)) / k, z: z + (Math.sin(yaw1) - Math.sin(yaw)) / k, yaw: yaw1 };
}

/** 区間の形（長さと曲率） */
function pieceShape(p: RoadPiece): { length: number; curvature: number } {
  if (p.arc) {
    const angle = (p.arc.turn * Math.PI) / 180;
    return { length: p.arc.radius * Math.abs(angle), curvature: Math.sign(angle) / p.arc.radius };
  }
  if (p.straight === undefined) throw new Error('A road piece needs straight or arc');
  return { length: p.straight, curvature: 0 };
}

/** 値を幅 window [m] の移動平均でなめらかにする（周回は継ぎ目をまたぐ） */
function smooth(values: Float64Array, window: number, step: number, closed: boolean): Float64Array {
  const n = values.length;
  const k = Math.max(1, Math.round(window / 2 / step));
  const out = new Float64Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + values[i];
  for (let i = 0; i < n; i++) {
    if (closed) {
      let sum = 0;
      for (let d = -k; d <= k; d++) sum += values[(((i + d) % n) + n) % n];
      out[i] = sum / (2 * k + 1);
    } else {
      // 端では窓を左右対称に縮める（端の値が変わらないように）
      const r = Math.min(k, i, n - 1 - i);
      out[i] = (prefix[i + r + 1] - prefix[i - r]) / (2 * r + 1);
    }
  }
  return out;
}

/** 平面の点を、近くの点だけ探せるよう格子に分けておく */
export class PointGrid {
  private readonly cells = new Map<number, number[]>();

  constructor(
    readonly xs: ArrayLike<number>,
    readonly zs: ArrayLike<number>,
    readonly cell = 16,
  ) {
    for (let i = 0; i < xs.length; i++) {
      const key = this.key(Math.floor(xs[i] / cell), Math.floor(zs[i] / cell));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(i);
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** (x, z) から radius [m] 以内の点の番号 */
  near(x: number, z: number, radius: number, out: number[] = []): number[] {
    const c = this.cell;
    for (let cx = Math.floor((x - radius) / c); cx <= Math.floor((x + radius) / c); cx++) {
      for (let cz = Math.floor((z - radius) / c); cz <= Math.floor((z + radius) / c); cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (list) for (const i of list) out.push(i);
      }
    }
    return out;
  }
}

/** 道路の終わりの U ターンの輪: 右に 60°、左に 300°、右に 60°（半径はすべて同じで、入口と同じ点に戻る） */
function buildTurnaround(x: number, z: number, yaw: number, radius: number): Turnaround {
  const loop: Turnaround['loop'] = [];
  const parts = [
    { turn: -Math.PI / 3 },
    { turn: (5 * Math.PI) / 3 },
    { turn: -Math.PI / 3 },
  ].map((p) => ({ length: radius * Math.abs(p.turn), curvature: Math.sign(p.turn) / radius }));
  const length = parts.reduce((a, p) => a + p.length, 0);
  const n = Math.round(length / ROAD_STEP);
  let state = { x, z, yaw };
  let pi = 0;
  let partStart = 0;
  let base = { ...state };
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * length;
    while (pi < parts.length - 1 && s > partStart + parts[pi].length) {
      base = advance(base.x, base.z, base.yaw, parts[pi].curvature, parts[pi].length);
      partStart += parts[pi].length;
      pi++;
    }
    state = advance(base.x, base.z, base.yaw, parts[pi].curvature, s - partStart);
    loop.push({ ...state, curvature: parts[pi].curvature });
  }
  // 広場の中心は、入口から前へ √3 r（左の大きな輪の中心）
  const d = Math.sqrt(3) * radius;
  return { x, z, yaw, radius, cx: x + Math.sin(yaw) * d, cz: z + Math.cos(yaw) * d, plaza: radius * 1.9, loop, length };
}

/** 区間をすべてたどった、道路の終わりの位置と向き */
function roadEnd(spec: RoadSpec): { x: number; z: number; yaw: number } {
  let st = { ...(spec.origin ?? ROAD_ORIGIN) };
  for (const p of spec.pieces) {
    const { length, curvature } = pieceShape(p);
    st = advance(st.x, st.z, st.yaw, curvature, length);
  }
  return st;
}

/**
 * 周回の道路を閉じる3つの区間（直線・半径 radius の円弧・直線）を最後に足す。円弧は side の向き
 * （1 = 左、-1 = 右）に、道路の始まりの向きに戻るまで曲がる。extra は足す区間に付ける指定（高さなど）。
 * 直線の長さが負になる（その半径では閉じられない）ときは例外
 */
export function closeLoop(
  origin: { x: number; z: number; yaw: number },
  pieces: readonly RoadPiece[],
  radius: number,
  side: 1 | -1,
  extra: Omit<RoadPiece, 'straight' | 'arc'> = {},
): RoadPiece[] {
  const e = roadEnd({ pieces, origin, width: 0, start: 0, scenery: 'touge' });
  let turn = (origin.yaw - e.yaw) % (2 * Math.PI);
  if (side > 0 && turn <= 0) turn += 2 * Math.PI;
  if (side < 0 && turn >= 0) turn -= 2 * Math.PI;
  const k = side / radius;
  const y1 = e.yaw + turn;
  // 円弧で動く量
  const dx = (Math.cos(e.yaw) - Math.cos(y1)) / k;
  const dz = (Math.sin(y1) - Math.sin(e.yaw)) / k;
  // a (sin e.yaw, cos e.yaw) + b (sin origin.yaw, cos origin.yaw) = 残り
  const rx = origin.x - e.x - dx;
  const rz = origin.z - e.z - dz;
  const [ax, az, bx, bz] = [Math.sin(e.yaw), Math.cos(e.yaw), Math.sin(origin.yaw), Math.cos(origin.yaw)];
  const det = ax * bz - az * bx;
  const a = (rx * bz - rz * bx) / det;
  const b = (ax * rz - az * rx) / det;
  if (!(a >= 0 && b >= 0)) throw new Error(`Cannot close the road with radius ${radius} (straights ${a.toFixed(1)}, ${b.toFixed(1)})`);
  const out: RoadPiece[] = [...pieces];
  if (a > 0.01) out.push({ straight: a, ...extra });
  out.push({ arc: { radius, turn: (turn * 180) / Math.PI }, ...extra });
  if (b > 0.01) out.push({ straight: b, ...extra });
  return out;
}

/** 道路の始まりの、省略したときの位置と向き（原点から東向き） */
export const ROAD_ORIGIN = { x: 0, z: 0, yaw: Math.PI / 2 };

/**
 * 同じ道路を終わりから始まりへ逆向きに走る道路（上りの峠から下りの峠を作る）。形・高さ・道幅は同じで、
 * スタートラインは逆向きの道路の始まりから start [m]
 */
export function reverseRoad(spec: RoadSpec, start: number): RoadSpec {
  const end = roadEnd(spec);
  const n = spec.pieces.length;
  const known = spec.pieces.filter((p) => p.h !== undefined);
  const pieces = spec.pieces.map((_, j) => {
    const i = n - 1 - j;
    const p = spec.pieces[i];
    // 逆向きの区間の終わり = 元の区間の始まり = 1つ前の区間の終わり
    const h = i === 0 ? (spec.startHeight ?? 0) : spec.pieces[i - 1].h;
    const piece: RoadPiece = { ...p, ...(p.arc ? { arc: { radius: p.arc.radius, turn: -p.arc.turn } } : {}) };
    delete piece.h;
    if (h !== undefined) piece.h = h;
    return piece;
  });
  return {
    ...spec,
    pieces,
    origin: { x: end.x, z: end.z, yaw: end.yaw + Math.PI },
    startHeight: known.length ? known[known.length - 1].h : (spec.startHeight ?? 0),
    start,
    turnaround: undefined,
    closed: false,
  };
}

export function buildRoad(spec: RoadSpec): RoadModel {
  const origin = spec.origin ?? ROAD_ORIGIN;
  const closed = spec.closed ?? false;
  // 区間の始まりの状態
  const states: PieceState[] = [];
  let st = { ...origin };
  let total = 0;
  for (const p of spec.pieces) {
    const { length, curvature } = pieceShape(p);
    states.push({ ...st, s: total, length, curvature });
    st = advance(st.x, st.z, st.yaw, curvature, length);
    total += length;
  }
  // 点の間隔は ROAD_STEP に近く、道路の終わりがちょうど点になるようにする
  const count = closed ? Math.round(total / ROAD_STEP) : Math.max(2, Math.round(total / ROAD_STEP) + 1);
  const ds = closed ? total / count : total / (count - 1);
  const length = total;
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const yaw = new Float64Array(count);
  const curvature = new Float64Array(count);
  const rawH = new Float64Array(count);
  const rawW = new Float64Array(count);
  const rawBump = new Float64Array(count);
  const flags = new Uint8Array(count);

  // 高さの指定点（区間の終わり）。指定のない区間は前後の点の間を一定の勾配でつなぐ
  const known: { s: number; h: number }[] = [{ s: 0, h: spec.startHeight ?? 0 }];
  spec.pieces.forEach((p, i) => {
    if (p.h !== undefined) known.push({ s: states[i].s + states[i].length, h: p.h });
  });
  const heightLinear = (s: number) => {
    if (s <= known[0].s) return known[0].h;
    for (let k = 1; k < known.length; k++) {
      if (s <= known[k].s) {
        const a = known[k - 1];
        const b = known[k];
        return a.h + ((b.h - a.h) * (s - a.s)) / Math.max(1e-6, b.s - a.s);
      }
    }
    return known[known.length - 1].h;
  };

  let pi = 0;
  for (let i = 0; i < count; i++) {
    const s = i * ds;
    while (pi < states.length - 1 && s >= states[pi].s + states[pi].length) pi++;
    const ps = states[pi];
    const p = spec.pieces[pi];
    const a = advance(ps.x, ps.z, ps.yaw, ps.curvature, s - ps.s);
    x[i] = a.x;
    z[i] = a.z;
    yaw[i] = a.yaw;
    curvature[i] = ps.curvature;
    rawH[i] = heightLinear(s);
    rawW[i] = p.width ?? spec.width;
    rawBump[i] = p.bumpy ? 1 : 0;
    flags[i] =
      (p.bridge ? FLAG_BRIDGE : 0) |
      (p.tunnel ? FLAG_TUNNEL : 0) |
      (p.bumpy ? FLAG_BUMPY : 0) |
      (p.suspension ? FLAG_SUSPENSION | FLAG_BRIDGE : 0) |
      (p.surface === 'new' ? FLAG_NEW : p.surface === 'old' ? FLAG_OLD : 0) |
      (p.gutter && p.arc ? FLAG_GUTTER : 0);
  }
  if (closed) {
    const gap = Math.hypot(st.x - origin.x, st.z - origin.z);
    const turn = Math.atan2(Math.sin(st.yaw - origin.yaw), Math.cos(st.yaw - origin.yaw));
    if (gap > 1 || Math.abs(turn) > 0.02) throw new Error(`The closed road does not return to its start (gap ${gap.toFixed(1)} m)`);
  }
  const h = smooth(rawH, HEIGHT_SMOOTH, ds, closed);
  const width = smooth(rawW, WIDTH_SMOOTH, ds, closed);
  const bump = Float32Array.from(smooth(rawBump, 16, ds, closed));

  // 立体交差: 道路に沿って離れた2点が平面で重なる所
  const layer = new Uint8Array(count);
  const grid = new PointGrid(x, z);
  const apart = Math.round(CROSS_APART / ds);
  const near: number[] = [];
  const mark = new Int8Array(count);
  for (let i = 0; i < count; i++) {
    near.length = 0;
    grid.near(x[i], z[i], (width[i] + 12) / 2 + CROSS_MARGIN + 8, near);
    for (const j of near) {
      let di = Math.abs(i - j);
      if (closed) di = Math.min(di, count - di);
      if (di < apart) continue;
      const d = Math.hypot(x[i] - x[j], z[i] - z[j]);
      if (d > (width[i] + width[j]) / 2 + CROSS_MARGIN) continue;
      if (h[i] > h[j] + CROSS_CLEARANCE) mark[i] = LAYER_UPPER;
      else if (h[j] > h[i] + CROSS_CLEARANCE && mark[i] !== LAYER_UPPER) mark[i] = LAYER_LOWER;
      else if (Math.abs(h[i] - h[j]) <= CROSS_CLEARANCE) {
        throw new Error(`The road crosses itself without enough height at ${(i * ds).toFixed(0)} m`);
      }
    }
  }
  const extend = Math.round(LAYER_EXTEND / ds);
  for (let i = 0; i < count; i++) {
    if (!mark[i]) continue;
    for (let d = -extend; d <= extend; d++) {
      const j = closed ? (((i + d) % count) + count) % count : i + d;
      if (j < 0 || j >= count) continue;
      // 上と下の両方の印が付く所は上を優先する
      if (layer[j] !== LAYER_UPPER) layer[j] = mark[i];
    }
  }

  const turnaround = spec.turnaround && !closed ? buildTurnaround(x[count - 1], z[count - 1], yaw[count - 1], spec.turnaround.radius) : null;

  const indexAt = (s: number) => {
    const i = Math.round(s / ds);
    return closed ? ((i % count) + count) % count : Math.min(count - 1, Math.max(0, i));
  };
  const lerpAt = (values: ArrayLike<number>, s: number) => {
    const f = s / ds;
    if (closed) {
      const i0 = ((Math.floor(f) % count) + count) % count;
      const i1 = (i0 + 1) % count;
      const u = f - Math.floor(f);
      return values[i0] + (values[i1] - values[i0]) * u;
    }
    const c = Math.min(count - 1, Math.max(0, f));
    const i0 = Math.min(count - 2, Math.floor(c));
    const u = c - i0;
    return values[i0] + (values[i0 + 1] - values[i0]) * u;
  };
  const pieceStart = [...states.map((p) => p.s), total];

  return {
    spec,
    closed,
    step: ds,
    count,
    length,
    x,
    z,
    yaw,
    curvature,
    h,
    width,
    bump,
    flags,
    layer,
    pieceStart,
    turnaround,
    indexAt,
    heightAt: (s) => lerpAt(h, s),
    gradeAt: (s) => (lerpAt(h, s + 1) - lerpAt(h, s - 1)) / 2,
    widthAt: (s) => lerpAt(width, s),
    hasFlag: (s, flag) => (flags[indexAt(s)] & flag) !== 0,
  };
}

/**
 * 荒れた路面の波の高さ [m]。s は道路に沿った距離、offset は中心から左へのずれ。
 * 舗装全体がゆるくうねっている（継ぎ目だけの段差ではない）。長さの違う波を重ね、左右でも少しずらして、
 * 車が前後・左右に揺すられるようにする。130km/h くらいまでは路面に張り付いたまま揺すられ、
 * それより速いと波の頂上で少し浮く（src/game/airborne.ts）
 */
export function bumpHeight(road: RoadModel, s: number, offset: number): number {
  const e = road.bump[road.indexAt(s)];
  if (e <= 0) return 0;
  const w = 2 * Math.PI;
  const wave = 0.65 * Math.sin((w * s) / 24 + 0.4) + 0.35 * Math.sin((w * s) / 11 + 1.7 + offset * 0.5);
  return BUMP_AMPLITUDE * e * wave;
}

/** 谷の深さを指定した橋の区間（道路の始まりからの距離） */
export function roadValleys(road: RoadModel): { from: number; to: number; depth: number }[] {
  return road.spec.pieces.flatMap((p, i) => (p.valley ? [{ from: road.pieceStart[i], to: road.pieceStart[i + 1], depth: p.valley }] : []));
}
