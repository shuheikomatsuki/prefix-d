import { BARRIER_HEIGHT, type BoxObstacle, type MapObstacles, type TreeObstacle, tileHash } from './obstacles';
import { FLAG_BLIND, FLAG_BRIDGE, FLAG_NEW, FLAG_OLD, FLAG_TUNNEL, LAYER_NONE, PointGrid, type RoadModel } from './road';
import { CUT_FOOT, CUT_TOP, type RoadCuts, buildRoadCuts, cutAt } from './roadCuts';
import { type Shortcut, insideShortcut } from './shortcuts';

/** 壁を区切る長さ [m] */
const WALL_SEGMENT = 4;
const BARRIER_THICKNESS = 0.5;

/** 道路の端から壁の内側までの距離 [m]（サーキットは退避帯の幅） */
export function wallGap(road: RoadModel): number {
  return road.spec.scenery === 'circuit' ? (road.spec.runoff ?? 6) : 0.25;
}

/** 岩の崖とみなす高さ [m]（これより低い所は壁を置かない） */
const CUT_WALL_MIN = 1.5;

/** 道路の点 i に壁があるか（首都高とサーキットはすべて、峠は橋とトンネルと、ガードレールのある新しい道） */
export function walledAt(road: RoadModel, i: number): boolean {
  return road.spec.scenery !== 'touge' || (road.flags[i] & (FLAG_BRIDGE | FLAG_TUNNEL | FLAG_NEW)) !== 0;
}

/** 道路の点 i の壁が、コンクリートの壁ではなくガードレールか（峠の拡幅工事を終えた新しい道。橋とトンネルは除く） */
export function guardrailAt(road: RoadModel, i: number): boolean {
  return road.spec.scenery === 'touge' && (road.flags[i] & FLAG_NEW) !== 0 && (road.flags[i] & (FLAG_BRIDGE | FLAG_TUNNEL)) === 0;
}

/**
 * 道路の点 i の近くの (x, z) に壁を置くと、同じ高さを通る道路の別の所（道路に沿って離れた所）にかかるか。
 * サーキットの退避帯の外の壁が、すぐ隣を並んで走る道路をふさがないようにする
 */
export function makeWallBlocked(road: RoadModel): (x: number, z: number, i: number) => boolean {
  const grid = new PointGrid(road.x, road.z);
  const near: number[] = [];
  const apart = Math.round(60 / road.step);
  return (x, z, i) => {
    near.length = 0;
    grid.near(x, z, 20, near);
    for (const k of near) {
      let di = Math.abs(k - i);
      if (road.closed) di = Math.min(di, road.count - di);
      if (di < apart || Math.abs(road.h[k] - road.h[i]) > 4) continue;
      if (Math.hypot(x - road.x[k], z - road.z[k]) < road.width[k] / 2 + 1) return true;
    }
    return false;
  };
}

/**
 * 中心線で描く道路の障害物: 道路の両側の壁（首都高とサーキットはすべて、峠は橋とトンネル）と木。
 * 立体交差の所の壁には層（layer）を付け、その層の道路を走る車とだけぶつかるようにする
 */
export function buildRoadObstacles(road: RoadModel, shortcuts: readonly Shortcut[] = []): MapObstacles {
  const boxes: BoxObstacle[] = [];
  const highway = road.spec.scenery === 'highway';
  const gap = wallGap(road);
  const blocked = makeWallBlocked(road);
  const { step, count } = road;
  const every = Math.round(WALL_SEGMENT / step);
  const segments = road.closed ? count : count - 1;
  for (let i = 0; i < segments; i += every) {
    const j = Math.min(road.closed ? i + every : count - 1, i + every);
    const a = i % count;
    const b = j % count;
    if (!walledAt(road, a) && !walledAt(road, b)) continue;
    const yaw = Math.atan2(road.x[b] - road.x[a], road.z[b] - road.z[a]);
    const mx = (road.x[a] + road.x[b]) / 2;
    const mz = (road.z[a] + road.z[b]) / 2;
    const len = Math.hypot(road.x[b] - road.x[a], road.z[b] - road.z[a]);
    const w = (road.width[a] + road.width[b]) / 2;
    const layer = road.layer[a] || road.layer[b];
    for (const side of [-1, 1]) {
      const off = side * (w / 2 + gap + BARRIER_THICKNESS / 2);
      // 左 = (cos yaw, -sin yaw)
      const bx = mx + Math.cos(yaw) * off;
      const bz = mz - Math.sin(yaw) * off;
      if (blocked(bx, bz, a)) continue;
      boxes.push({
        kind: 'barrier',
        x: bx,
        y: BARRIER_HEIGHT / 2,
        z: bz,
        hx: BARRIER_THICKNESS / 2,
        hy: BARRIER_HEIGHT / 2,
        // カーブで隙間ができないよう少し長くする
        hz: len / 2 + 0.3,
        yaw,
        variant: 0,
        layer: layer === LAYER_NONE ? undefined : layer,
      });
    }
  }
  const cuts = road.flags.some((f) => f & FLAG_BLIND) ? buildRoadCuts(road) : null;
  if (cuts) boxes.push(...cutWalls(road, cuts));
  return { boxes, trees: highway ? [] : roadTrees(road, shortcuts, cuts), cones: [], signs: [] };
}

/** 見通しの悪い区間の山側の岩の崖に、ぶつかる壁（見えない箱。見た目は地面の崖） */
function cutWalls(road: RoadModel, cuts: RoadCuts): BoxObstacle[] {
  const boxes: BoxObstacle[] = [];
  const every = Math.round(WALL_SEGMENT / road.step);
  for (let a = 0; a + every < road.count; a += every) {
    const b = a + every;
    const yaw = Math.atan2(road.x[b] - road.x[a], road.z[b] - road.z[a]);
    const mx = (road.x[a] + road.x[b]) / 2;
    const mz = (road.z[a] + road.z[b]) / 2;
    const len = Math.hypot(road.x[b] - road.x[a], road.z[b] - road.z[a]);
    const w = (road.width[a] + road.width[b]) / 2;
    for (const side of [-1, 1]) {
      if (Math.min(cutAt(cuts, a, side), cutAt(cuts, b, side)) < CUT_WALL_MIN) continue;
      // 崖の下の端から少し上がった所（崖の面の途中）に壁の内側を合わせる
      const off = side * (w / 2 + CUT_FOOT + 0.5 + BARRIER_THICKNESS / 2);
      boxes.push({
        kind: 'barrier',
        x: mx + Math.cos(yaw) * off,
        y: BARRIER_HEIGHT / 2,
        z: mz - Math.sin(yaw) * off,
        hx: BARRIER_THICKNESS / 2,
        hy: BARRIER_HEIGHT / 2,
        hz: len / 2 + 0.3,
        yaw,
        variant: 0,
      });
    }
  }
  return boxes;
}

/**
 * 峠の木。道路の両側の森で、狭い古い道と見通しの悪い区間は道路のすぐ脇まで木が茂る（山側の岩の崖の面には生えない）。
 * 橋の上（谷）・トンネルの上・他の道路の上・U ターンの広場・ヘアピンの内側の近道の帯には置かない
 */
function roadTrees(road: RoadModel, shortcuts: readonly Shortcut[], cuts: RoadCuts | null): TreeObstacle[] {
  const trees: TreeObstacle[] = [];
  const grid = new PointGrid(road.x, road.z);
  const near: number[] = [];
  const turn = road.turnaround;
  /** その点がどの道路の端からも gap [m] より離れているか */
  const clear = (x: number, z: number, gap: number) => {
    near.length = 0;
    grid.near(x, z, 30, near);
    for (const k of near) {
      if (Math.hypot(x - road.x[k], z - road.z[k]) < road.width[k] / 2 + gap) return false;
      if (road.flags[k] & FLAG_BRIDGE && Math.hypot(x - road.x[k], z - road.z[k]) < 40) return false;
    }
    if (shortcuts.some((sc) => insideShortcut(sc, x, z))) return false;
    return !(turn && Math.hypot(x - turn.cx, z - turn.cz) < turn.plaza + 4);
  };
  const spacing = 5;
  const every = Math.round(spacing / road.step);
  for (let i = 0; i < road.count; i += every) {
    if (road.flags[i] & (FLAG_BRIDGE | FLAG_TUNNEL)) continue;
    const old = (road.flags[i] & FLAG_OLD) !== 0;
    const blind = (road.flags[i] & FLAG_BLIND) !== 0;
    // 拡幅した新しい道は、山を切り開いたので木が遠い
    const widened = (road.flags[i] & FLAG_NEW) !== 0;
    const yaw = road.yaw[i];
    for (const side of [-1, 1]) {
      // 古い道は手前の列（道路のすぐ脇）にも木がある
      const far = road.spec.scenery === 'circuit' ? wallGap(road) + 4 : 0;
      const rows = blind ? [2.4, 4.6, 7.5, 11, 16] : old ? [2.6, 5.5, 10, 16] : widened ? [13, 19, 26] : [7 + far, 13 + far, 20 + far];
      const cut = cuts ? cutAt(cuts, i, side) > 0 : false;
      rows.forEach((base, r) => {
        const salt = r * 7 + (side > 0 ? 3 : 0);
        // 岩の崖の面（上の端まで）には生えない
        if (cut && base < CUT_TOP + 1) return;
        if (tileHash(i, salt, 11) > (blind ? 0.9 : old ? 0.85 : far ? 0.3 : 0.6)) return;
        const off = side * (road.width[i] / 2 + base + tileHash(i, salt, 12) * 2.5);
        const along = (tileHash(i, salt, 13) - 0.5) * spacing;
        const x = road.x[i] + Math.cos(yaw) * off + Math.sin(yaw) * along;
        const z = road.z[i] - Math.sin(yaw) * off + Math.cos(yaw) * along;
        if (!clear(x, z, base * 0.8)) return;
        trees.push({ x, z, trunkRadius: 0.3, height: 7 + tileHash(i, salt, 14) * 5 });
      });
    }
  }
  return trees;
}
