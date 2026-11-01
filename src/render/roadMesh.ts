import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BARRIER_HEIGHT, type MapObstacles, tileHash } from '../map/obstacles';
import {
  FLAG_BRIDGE,
  FLAG_GUTTER,
  FLAG_NEW,
  FLAG_OLD,
  FLAG_SUSPENSION,
  FLAG_TUNNEL,
  GUTTER_WIDTH,
  PointGrid,
  type RoadModel,
  bumpHeight,
} from '../map/road';
import { guardrailAt, makeWallBlocked, wallGap, walledAt } from '../map/roadObstacles';
import type { RoadGround } from '../map/roadTerrain';
import { COLORS, mergeMixed, terrainGeometry } from './mapMesh';

/** 橋・高架の床の厚さ [m] */
const DECK_THICKNESS = 1.4;
/** 橋脚・高架の柱の間隔 [m] */
const PIER_SPACING = 30;
/** 首都高の吊り橋の主塔の、路面からの高さ [m] */
const TOWER_HEIGHT = 52;

type V = [number, number, number];

/** 道路の点 i での、中心線の位置・高さと左向きの単位ベクトル */
function frame(road: RoadModel, i: number) {
  const yaw = road.yaw[i];
  return { x: road.x[i], z: road.z[i], y: road.h[i], lx: Math.cos(yaw), lz: -Math.sin(yaw), fx: Math.sin(yaw), fz: Math.cos(yaw), w: road.width[i], s: i * road.step };
}

/** 三角形を、法線が上（+Y）を向くように並べて加える */
function pushUp(out: number[], a: V, b: V, c: V) {
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  if (ny >= 0) out.push(...a, ...b, ...c);
  else out.push(...a, ...c, ...b);
}

function geometry(positions: number[], colors?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/** 条件に合う道路の点が続く範囲 [i0, i1]（周回の道路では継ぎ目をまたぐ範囲を1つにつなぐ） */
function ranges(road: RoadModel, member: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < road.count; i++) {
    if (member(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      out.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0) out.push([start, road.count - 1]);
  if (road.closed && out.length > 1 && out[0][0] === 0 && out[out.length - 1][1] === road.count - 1) {
    const last = out.pop()!;
    out[0] = [last[0], out[0][1] + road.count];
  }
  return out;
}

/** 範囲 [i0, i1] を stride ごとにたどる点の番号（周回の道路では count 以上は一周して戻る） */
function indices(road: RoadModel, i0: number, i1: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = i0; i < i1; i += stride) out.push(i % road.count);
  out.push(i1 % road.count);
  return out;
}

/**
 * 道路に沿って断面（横 u・高さ v の点の並び）をつないだ面。lift はその点の路面からの高さの足し分
 * （荒れた路面の波など）
 */
function sweep(road: RoadModel, idx: number[], profile: readonly [number, number][], out: number[], lift?: (i: number, u: number) => number) {
  let prev: V[] | null = null;
  for (const i of idx) {
    const f = frame(road, i);
    const ring = profile.map(([u, v]): V => [f.x + f.lx * u, f.y + v + (lift ? lift(i, u) : 0), f.z + f.lz * u]);
    if (prev) {
      for (let k = 0; k + 1 < ring.length; k++) {
        out.push(...prev[k], ...prev[k + 1], ...ring[k + 1], ...prev[k], ...ring[k + 1], ...ring[k]);
      }
    }
    prev = ring;
  }
}

/**
 * 拡幅工事を終えた新しい道の脇の地面の色: 山を削った急な斜面（法面）は吹き付けたばかりの明るいコンクリート、
 * なだらかな所は種をまいたばかりの明るい芝にする
 */
function newRoadCuts(road: RoadModel, grid: PointGrid): ((x: number, z: number, steep: number, color: THREE.Color) => void) | undefined {
  if (road.spec.scenery !== 'touge' || !road.flags.some((f) => (f & FLAG_NEW) !== 0)) return undefined;
  const slope = new THREE.Color(0xbdbab0);
  const seeded = new THREE.Color(0x9cc76e);
  const near: number[] = [];
  return (x, z, steep, color) => {
    near.length = 0;
    grid.near(x, z, 30, near);
    let best = Infinity;
    for (const k of near) {
      if ((road.flags[k] & FLAG_NEW) === 0 || road.flags[k] & (FLAG_BRIDGE | FLAG_TUNNEL)) continue;
      best = Math.min(best, Math.hypot(x - road.x[k], z - road.z[k]) - road.width[k] / 2);
    }
    // 道路の端から 22m まで。遠くなるほど元の色に戻す
    const t = 1 - Math.min(1, Math.max(0, (best - 14) / 8));
    if (t <= 0) return;
    color.lerp(steep > 0.25 ? slope : seeded, t * (steep > 0.25 ? Math.min(1, steep * 1.5) : 0.6));
  };
}

/** 中心線で描く道路のマップの見た目 */
export function buildRoadMesh(road: RoadModel, obstacles: MapObstacles, ground: RoadGround | null): THREE.Group {
  const group = new THREE.Group();
  const highway = road.spec.scenery === 'highway';
  const circuit = road.spec.scenery === 'circuit';
  const lowY = highway ? (road.spec.highway?.ground ?? -14) : 0;
  const layer = (n: number) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -n });
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, shadow = true) => {
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = shadow;
    group.add(m);
    return m;
  };
  const grid = new PointGrid(road.x, road.z);
  /** その点の真下（他の道路の上）に柱を立ててよいか */
  const clearBelow = (x: number, z: number, self: number) => {
    const near = grid.near(x, z, 20);
    return near.every((k) => {
      let di = Math.abs(k - self);
      if (road.closed) di = Math.min(di, road.count - di);
      return di < 40 / road.step || Math.hypot(x - road.x[k], z - road.z[k]) > road.width[k] / 2 + 3;
    });
  };

  // --- 地面 ---
  if (ground) {
    const terrain = add(terrainGeometry(ground, newRoadCuts(road, grid)), new THREE.MeshLambertMaterial({ vertexColors: true }), false);
    terrain.receiveShadow = true;
    const low = ground.grid.ground.reduce((a, b) => Math.min(a, b), Infinity) - 2;
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: COLORS.outside }));
    outside.position.set(road.x[0], low, road.z[0]);
    group.add(outside);
    const water = ground.rivers.map((r) => {
      const g = new THREE.PlaneGeometry(16, r.length).rotateX(-Math.PI / 2);
      g.rotateY(r.yaw);
      g.translate(r.x, r.y, r.z);
      return g;
    });
    if (water.length) add(mergeGeometries(water), new THREE.MeshPhongMaterial({ color: COLORS.water, shininess: 40, specular: 0x30485a }), false);
  } else if (circuit) {
    // サーキットは平らな芝生
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < road.count; i++) {
      cx += road.x[i] / road.count;
      cz += road.z[i] / road.count;
    }
    // 大きな1枚の面だと奥行きの精度が足りず、近くで路面の上に透けて見えるので、細かく分けて少し下げる
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000, 80, 80).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: COLORS.grass }));
    lawn.position.set(cx, -0.08, cz);
    lawn.receiveShadow = true;
    group.add(lawn);
  } else {
    group.add(buildCity(road, lowY));
  }

  // --- 路面（荒れた区間は波打たせ、古い道と新しい舗装で色を変える） ---
  const surface: number[] = [];
  const surfaceColors: number[] = [];
  const base = new THREE.Color(COLORS.road);
  const oldColor = new THREE.Color(0x6a6c70);
  const newColor = new THREE.Color(0x303339);
  const lift = (i: number, u: number) => bumpHeight(road, i * road.step, u);
  {
    const last = road.closed ? road.count : road.count - 1;
    let prev: { ring: V[]; color: THREE.Color } | null = null;
    for (let i = 0; i <= last; i++) {
      const k = i % road.count;
      // 荒れた区間は 1m ごと、そうでなければ 2m ごと
      if (i % 2 === 1 && road.bump[k] === 0 && i !== last) continue;
      const f = frame(road, k);
      const lanes = road.bump[k] > 0 ? 6 : 1;
      const ring: V[] = [];
      for (let j = 0; j <= lanes; j++) {
        const u = -f.w / 2 + (f.w * j) / lanes;
        ring.push([f.x + f.lx * u, f.y + 0.02 + lift(k, u), f.z + f.lz * u]);
      }
      const color = road.flags[k] & FLAG_OLD ? oldColor : road.flags[k] & FLAG_NEW ? newColor : base;
      if (prev && prev.ring.length === ring.length) {
        for (let j = 0; j < lanes; j++) {
          const before = surface.length;
          pushUp(surface, prev.ring[j], prev.ring[j + 1], ring[j + 1]);
          pushUp(surface, prev.ring[j], ring[j + 1], ring[j]);
          for (let v = before; v < surface.length; v += 3) surfaceColors.push(color.r, color.g, color.b);
        }
      } else if (prev) {
        // 波打つ区間の境目: 細かさの違う断面をつなぐ（両端の点だけでつなぐ）
        const a = prev.ring;
        const before = surface.length;
        pushUp(surface, a[0], a[a.length - 1], ring[ring.length - 1]);
        pushUp(surface, a[0], ring[ring.length - 1], ring[0]);
        for (let v = before; v < surface.length; v += 3) surfaceColors.push(color.r, color.g, color.b);
      }
      prev = { ring, color };
    }
  }
  // U ターンの広場
  const turn = road.turnaround;
  if (turn) {
    const y = road.h[road.count - 1] + 0.015;
    const disc = new THREE.CircleGeometry(turn.plaza, 48).rotateX(-Math.PI / 2).toNonIndexed();
    disc.translate(turn.cx, y, turn.cz);
    const p = disc.attributes.position.array as Float32Array;
    surface.push(...p);
    for (let v = 0; v < p.length; v += 3) surfaceColors.push(base.r, base.g, base.b);
    // 真ん中の島（芝生と木）
    const island = new THREE.CylinderGeometry(turn.radius - road.width[road.count - 1] / 2 - 1.2, turn.radius - road.width[road.count - 1] / 2 - 1, 0.3, 32);
    island.translate(turn.cx, y + 0.15, turn.cz);
    add(island, new THREE.MeshLambertMaterial({ color: COLORS.grass }));
  }
  add(geometry(surface, surfaceColors), new THREE.MeshLambertMaterial({ vertexColors: true, ...layer(1) }), false);

  // --- 白線・センターライン ---
  const edgeLines: number[] = [];
  const centerLines: number[] = [];
  const lineW = 0.15;
  const lanes = highway ? (road.spec.highway?.lanes ?? 2) : circuit ? 1 : 2;
  {
    const strip = (out: number[], idx: number[], u: number) =>
      sweep(road, idx, [[u - lineW / 2, 0.035], [u + lineW / 2, 0.035]], out, lift);
    for (const [i0, i1] of ranges(road, (i) => (road.flags[i] & FLAG_OLD) === 0)) {
      const idx = indices(road, i0, i1, road.bump[i0 % road.count] > 0 ? 1 : 2);
      // 道幅は場所で変わるので、端の線は点ごとに位置を変える
      for (const side of [-1, 1]) {
        let prev: V[] | null = null;
        for (const i of idx) {
          const f = frame(road, i);
          const u = side * (f.w / 2 - 0.45);
          const ring: V[] = [u - lineW / 2, u + lineW / 2].map((uu): V => [f.x + f.lx * uu, f.y + 0.035 + lift(i, uu), f.z + f.lz * uu]);
          if (prev) {
            pushUp(edgeLines, prev[0], prev[1], ring[1]);
            pushUp(edgeLines, prev[0], ring[1], ring[0]);
          }
          prev = ring;
        }
      }
      // 車線の境目: 首都高は白の破線、峠の新しい舗装は黄色の実線（はみ出し禁止）、それ以外は白の破線
      const solid = !highway && (road.flags[i0 % road.count] & FLAG_NEW) !== 0;
      for (let d = 1; d < lanes; d++) {
        const frac = d / lanes - 0.5;
        if (solid) {
          let prev: V[] | null = null;
          for (const i of idx) {
            const f = frame(road, i);
            const u = frac * f.w;
            const ring: V[] = [u - lineW / 2, u + lineW / 2].map((uu): V => [f.x + f.lx * uu, f.y + 0.035 + lift(i, uu), f.z + f.lz * uu]);
            if (prev) {
              pushUp(centerLines, prev[0], prev[1], ring[1]);
              pushUp(centerLines, prev[0], ring[1], ring[0]);
            }
            prev = ring;
          }
          continue;
        }
        // 破線: 5m 引いて 5m あける
        for (let k = 0; k < idx.length; k++) {
          const i = idx[k];
          if (Math.floor((i * road.step) / 5) % 2 === 1) continue;
          const j = idx[k + 1];
          if (j === undefined) break;
          strip(highway ? edgeLines : centerLines, [i, j], frac * road.width[i]);
        }
      }
    }
  }
  if (edgeLines.length) add(geometry(edgeLines), new THREE.MeshLambertMaterial({ color: COLORS.line, ...layer(2) }), false);
  if (centerLines.length) add(geometry(centerLines), new THREE.MeshLambertMaterial({ color: COLORS.centerLine, ...layer(2) }), false);

  // --- 橋・高架の床と柱 ---
  const decks: number[] = [];
  const piers: THREE.BufferGeometry[] = [];
  const deckMember = (i: number) => highway || (road.flags[i] & FLAG_BRIDGE) !== 0;
  for (const [i0, i1] of ranges(road, deckMember)) {
    const idx = indices(road, Math.max(0, i0 - (highway ? 0 : 6)), Math.min(road.closed ? i1 + 6 : road.count - 1, i1 + (highway ? 0 : 6)), 2);
    const prof = (w: number): [number, number][] => [
      [-w / 2 - 1, -0.02],
      [-w / 2 - 1, -DECK_THICKNESS],
      [w / 2 + 1, -DECK_THICKNESS],
      [w / 2 + 1, -0.02],
    ];
    // 道幅が変わっても床が合うよう、点ごとに断面を作る
    let prev: V[] | null = null;
    for (const i of idx) {
      const f = frame(road, Math.min(road.count - 1, i));
      const ring = prof(f.w).map(([u, v]): V => [f.x + f.lx * u, f.y + v, f.z + f.lz * u]);
      if (prev) for (let k = 0; k + 1 < ring.length; k++) decks.push(...prev[k], ...prev[k + 1], ...ring[k + 1], ...prev[k], ...ring[k + 1], ...ring[k]);
      prev = ring;
    }
    const every = Math.round(PIER_SPACING / road.step);
    for (let ii = i0 + Math.round(every / 2); ii < i1; ii += every) {
      const i = ii % road.count;
      if (road.flags[i] & FLAG_SUSPENSION) continue;
      const f = frame(road, i);
      const top = f.y - DECK_THICKNESS;
      const bottom = ground ? ground.groundAt(f.x, f.z) - 2 : lowY;
      if (top - bottom < 2 || !clearBelow(f.x, f.z, i)) continue;
      const p = new THREE.BoxGeometry(highway ? 2.4 : 3, top - bottom, highway ? f.w * 0.5 : 4.5);
      p.rotateY(road.yaw[i] + Math.PI / 2);
      p.translate(f.x, (top + bottom) / 2, f.z);
      piers.push(p);
    }
  }
  const deckMat = new THREE.MeshLambertMaterial({ color: COLORS.deck, side: THREE.DoubleSide });
  if (decks.length) add(geometry(decks), deckMat);
  if (piers.length) add(mergeMixed(piers), deckMat);

  // --- 欄干・高架の壁・サーキットの壁（衝突体は短い箱だが、見た目は道路に沿ってなめらかにつなぐ） ---
  const walls: number[] = [];
  const gap = wallGap(road);
  const blocked = makeWallBlocked(road);
  for (const [i0, i1] of ranges(road, (i) => walledAt(road, i) && !guardrailAt(road, i))) {
    const idx = indices(road, i0, i1, 2);
    for (const side of [-1, 1]) {
      let prev: V[] | null = null;
      for (const i of idx) {
        const f = frame(road, i);
        const u0 = side * (f.w / 2 + gap);
        const u1 = side * (f.w / 2 + gap + 0.5);
        // 隣を並んで走る道路にかかる所は壁を切る（衝突体と同じ）
        if (blocked(f.x + f.lx * (u0 + u1) / 2, f.z + f.lz * (u0 + u1) / 2, i)) {
          prev = null;
          continue;
        }
        const ring: V[] = [
          [u0, -0.3],
          [u0, BARRIER_HEIGHT],
          [u1, BARRIER_HEIGHT],
          [u1, -DECK_THICKNESS],
        ].map(([u, v]): V => [f.x + f.lx * u, f.y + v, f.z + f.lz * u]);
        if (prev) for (let k = 0; k + 1 < ring.length; k++) walls.push(...prev[k], ...prev[k + 1], ...ring[k + 1], ...prev[k], ...ring[k + 1], ...ring[k]);
        prev = ring;
      }
    }
  }
  if (walls.length) add(geometry(walls), new THREE.MeshLambertMaterial({ color: circuit ? COLORS.guardrail : COLORS.concrete, side: THREE.DoubleSide }));
  group.add(buildGuardrails(road, gap, blocked, lift));

  // --- サーキットのカーブの縁石（赤と白） ---
  if (circuit) group.add(buildCurbs(road));
  // --- 峠のカーブの内側の側溝（溝落とし） ---
  if (road.flags.some((f) => f & FLAG_GUTTER)) group.add(buildGutters(road));

  // --- トンネル・吊り橋・街灯 ---
  for (const [i0, i1] of ranges(road, (i) => (road.flags[i] & FLAG_TUNNEL) !== 0)) group.add(buildTunnel(road, i0, i1));
  for (const [i0, i1] of ranges(road, (i) => (road.flags[i] & FLAG_SUSPENSION) !== 0)) group.add(buildSuspension(road, i0, i1, lowY));
  if (highway) group.add(buildLamps(road));

  // --- 木 ---
  const trunks: THREE.BufferGeometry[] = [];
  const leaves: THREE.BufferGeometry[] = [];
  for (const t of obstacles.trees) {
    const baseY = (ground ? ground.groundAt(t.x, t.z) : lowY) - 0.5;
    const trunkH = t.height * 0.4;
    const trunk = new THREE.CylinderGeometry(t.trunkRadius, t.trunkRadius, trunkH, 6);
    trunk.translate(t.x, baseY + trunkH / 2, t.z);
    trunks.push(trunk);
    const cone = new THREE.ConeGeometry(t.height * 0.3, t.height * 0.7, 7);
    cone.translate(t.x, baseY + trunkH + t.height * 0.3, t.z);
    leaves.push(cone);
  }
  if (turn) {
    const y = road.h[road.count - 1];
    const cone = new THREE.ConeGeometry(3, 9, 8);
    cone.translate(turn.cx, y + 6, turn.cz);
    leaves.push(cone);
    const trunk = new THREE.CylinderGeometry(0.35, 0.35, 2, 6);
    trunk.translate(turn.cx, y + 1, turn.cz);
    trunks.push(trunk);
  }
  if (trunks.length) add(mergeMixed(trunks), new THREE.MeshLambertMaterial({ color: COLORS.trunk }));
  if (leaves.length) add(mergeMixed(leaves), new THREE.MeshLambertMaterial({ color: COLORS.leaves, flatShading: true }));
  return group;
}

/**
 * 峠の拡幅工事を終えた新しい道の、真新しい白いガードレール（衝突体は壁と同じ短い箱）。
 * 路肩には新しいコンクリートの側溝、支柱には 20m ごとに視線誘導標（オレンジの反射板）を付ける
 */
function buildGuardrails(road: RoadModel, gap: number, blocked: (x: number, z: number, i: number) => boolean, lift: (i: number, u: number) => number): THREE.Group {
  const group = new THREE.Group();
  const rails: number[] = [];
  const gutters: number[] = [];
  const posts: THREE.BufferGeometry[] = [];
  const reflectors: THREE.BufferGeometry[] = [];
  const postEvery = Math.round(4 / road.step);
  const reflectorEvery = Math.round(20 / road.step);
  for (const [i0, i1] of ranges(road, (i) => guardrailAt(road, i))) {
    const idx = indices(road, i0, i1, 2);
    for (const side of [-1, 1]) {
      let rail: V[] | null = null;
      let gutter: V[] | null = null;
      for (const i of idx) {
        const f = frame(road, i);
        const u = side * (f.w / 2 + gap + 0.2);
        if (blocked(f.x + f.lx * u, f.z + f.lz * u, i)) {
          rail = gutter = null;
          continue;
        }
        const at = (uu: number, v: number): V => [f.x + f.lx * uu, f.y + v, f.z + f.lz * uu];
        // 波形のビーム: 上下2段の面（少し折って立体に見せる）
        const ring: V[] = [at(u, 0.45), at(u - side * 0.06, 0.6), at(u, 0.75), at(u - side * 0.06, 0.9)];
        if (rail) for (let k = 0; k + 1 < ring.length; k++) rails.push(...rail[k], ...rail[k + 1], ...ring[k + 1], ...rail[k], ...ring[k + 1], ...ring[k]);
        rail = ring;
        const edge = side * (f.w / 2);
        const g: V[] = [at(edge, 0.03 + lift(i, edge)), at(u + side * 0.3, 0.03)];
        if (gutter) {
          pushUp(gutters, gutter[0], gutter[1], g[1]);
          pushUp(gutters, gutter[0], g[1], g[0]);
        }
        gutter = g;
        if (i % postEvery === 0) {
          const pu = u + side * 0.12;
          const post = new THREE.BoxGeometry(0.12, 1.4, 0.12);
          post.rotateY(road.yaw[i]);
          post.translate(f.x + f.lx * pu, f.y + 0.2, f.z + f.lz * pu);
          posts.push(post);
          if (i % reflectorEvery === 0) {
            const r = new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).rotateZ(Math.PI / 2);
            r.rotateY(road.yaw[i] + Math.PI / 2);
            r.translate(f.x + f.lx * pu, f.y + 1.0, f.z + f.lz * pu);
            reflectors.push(r);
          }
        }
      }
    }
  }
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  if (rails.length) mesh(geometry(rails), new THREE.MeshLambertMaterial({ color: 0xf4f5f6, side: THREE.DoubleSide })).castShadow = true;
  if (gutters.length) mesh(geometry(gutters), new THREE.MeshLambertMaterial({ color: 0xc9c7c0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  if (posts.length) mesh(mergeGeometries(posts), new THREE.MeshLambertMaterial({ color: COLORS.guardrailPost }));
  if (reflectors.length) mesh(mergeGeometries(reflectors), new THREE.MeshBasicMaterial({ color: 0xff8a1c }));
  return group;
}

/** サーキットのカーブの両側の縁石。3m ごとに赤と白をくり返す */
function buildCurbs(road: RoadModel): THREE.Group {
  const red: number[] = [];
  const white: number[] = [];
  const curbW = 1.2;
  const last = road.closed ? road.count : road.count - 1;
  for (let i = 0; i < last; i++) {
    const a = i % road.count;
    const b = (i + 1) % road.count;
    if (road.curvature[a] === 0 && road.curvature[b] === 0) continue;
    const out = Math.floor((i * road.step) / 3) % 2 === 0 ? red : white;
    for (const side of [-1, 1]) {
      const ring = (k: number): V[] => {
        const f = frame(road, k);
        return [f.w / 2, f.w / 2 + curbW].map((u): V => [f.x + f.lx * u * side, f.y + 0.04, f.z + f.lz * u * side]);
      };
      const p = ring(a);
      const q = ring(b);
      pushUp(out, p[0], p[1], q[1]);
      pushUp(out, p[0], q[1], q[0]);
    }
  }
  const group = new THREE.Group();
  for (const [positions, color] of [
    [red, 0xd23a32],
    [white, 0xf2f2f2],
  ] as const) {
    if (!positions.length) continue;
    const m = new THREE.Mesh(geometry(positions), new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/** カーブの内側の路肩の側溝: コンクリートのふちと、暗い溝の底 */
function buildGutters(road: RoadModel): THREE.Group {
  const lip: number[] = [];
  const pit: number[] = [];
  const LIP = 0.08;
  // [内側の端, 外側の端, 高さ, 面]（溝の底は少し低く描く）
  const bands: [number, number, number, number[]][] = [
    [0, LIP, 0.03, lip],
    [LIP, GUTTER_WIDTH - LIP, -0.06, pit],
    [GUTTER_WIDTH - LIP, GUTTER_WIDTH, 0.03, lip],
  ];
  for (let i = 0; i + 1 < road.count; i++) {
    if (!(road.flags[i] & FLAG_GUTTER) || !(road.flags[i + 1] & FLAG_GUTTER)) continue;
    const side = Math.sign(road.curvature[i]) || 1;
    for (const [u0, u1, v, out] of bands) {
      const ring = (k: number): V[] => {
        const f = frame(road, k);
        return [f.w / 2 + u0, f.w / 2 + u1].map((u): V => [f.x + f.lx * u * side, f.y + v, f.z + f.lz * u * side]);
      };
      const p = ring(i);
      const q = ring(i + 1);
      pushUp(out, p[0], p[1], q[1]);
      pushUp(out, p[0], q[1], q[0]);
    }
  }
  const group = new THREE.Group();
  for (const [positions, color] of [
    [lip, 0xb9b6ad],
    [pit, 0x2b2a27],
  ] as const) {
    if (!positions.length) continue;
    const m = new THREE.Mesh(geometry(positions), new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

/** トンネルの中の断面（道路の中心からの横 u・路面からの高さ v）。壁と半円のアーチ */
function tunnelProfile(halfWidth: number, wall: number, arch: number): [number, number][] {
  const points: [number, number][] = [[-halfWidth, -0.5]];
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * (1 - k / 10);
    points.push([halfWidth * Math.cos(a), wall + arch * Math.sin(a)]);
  }
  points.push([halfWidth, -0.5]);
  return points;
}

/** トンネル: 中のコンクリートの壁と天井、道路を覆う山、出入り口の坑口、天井の照明 */
function buildTunnel(road: RoadModel, i0: number, i1: number): THREE.Group {
  const group = new THREE.Group();
  const idx = indices(road, i0, i1, 2);
  const inner: number[] = [];
  const earth: number[] = [];
  const portal: number[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const rings = idx.map((i) => {
    const f = frame(road, i);
    const tw = f.w / 2 + 0.9;
    const profiles = {
      inner: tunnelProfile(tw, 4.2, 3.2),
      frame: tunnelProfile(tw + 1.4, 4.2, 4.6),
      outer: [[-tw - 22, -16] as [number, number], ...tunnelProfile(tw + 10, 2, 12).slice(1, -1), [tw + 22, -16] as [number, number]],
      floor: [
        [-tw, 0.02],
        [-f.w / 2, 0.02],
      ] as [number, number][],
      floorR: [
        [f.w / 2, 0.02],
        [tw, 0.02],
      ] as [number, number][],
    };
    const ring = (p: [number, number][]) => p.map(([u, v]): V => [f.x + f.lx * u, f.y + v, f.z + f.lz * u]);
    return { f, inner: ring(profiles.inner), frame: ring(profiles.frame), outer: ring(profiles.outer), floor: ring(profiles.floor), floorR: ring(profiles.floorR) };
  });
  const quads = (out: number[], a: V[], b: V[]) => {
    for (let k = 0; k + 1 < a.length; k++) out.push(...a[k], ...a[k + 1], ...b[k + 1], ...a[k], ...b[k + 1], ...b[k]);
  };
  for (let r = 0; r + 1 < rings.length; r++) {
    quads(inner, rings[r].inner, rings[r + 1].inner);
    quads(earth, rings[r].outer, rings[r + 1].outer);
    quads(inner, rings[r].floor, rings[r + 1].floor);
    quads(inner, rings[r].floorR, rings[r + 1].floorR);
  }
  for (let r = 0; r < rings.length; r += 5) {
    const { f } = rings[r];
    const lamp = new THREE.BoxGeometry(0.5, 0.15, 1.6);
    lamp.rotateY(Math.atan2(f.fx, f.fz));
    lamp.translate(f.x, f.y + 4.2 + 3.2 - 0.25, f.z);
    lamps.push(lamp);
  }
  // 坑口: 中の断面と外の枠の間、外の枠と山の間をふさぐ
  for (const ring of [rings[0], rings[rings.length - 1]]) {
    quads(portal, ring.inner, ring.frame);
    // 山の断面は点の数が違うので、枠の点からいちばん近い山の点へつなぐ
    const outer = ring.outer.slice(1, -1);
    quads(earth, ring.frame.slice(1, -1), outer);
  }
  const doubleSide = { side: THREE.DoubleSide };
  const earthGeo = geometry(earth);
  const normal = earthGeo.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  const grass = new THREE.Color(COLORS.grass);
  const rock = new THREE.Color(COLORS.rock);
  const c = new THREE.Color();
  for (let k = 0; k < normal.count; k++) {
    const steep = Math.min(1, Math.max(0, (0.8 - Math.abs(normal.getY(k))) / 0.3));
    c.copy(grass).lerp(rock, steep).toArray(colors, k * 3);
  }
  earthGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const [g, mat] of [
    [earthGeo, new THREE.MeshLambertMaterial({ vertexColors: true, ...doubleSide })],
    [geometry(inner), new THREE.MeshLambertMaterial({ color: COLORS.tunnel, ...doubleSide })],
    [geometry(portal), new THREE.MeshLambertMaterial({ color: COLORS.concrete, ...doubleSide })],
  ] as const) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  if (lamps.length) group.add(new THREE.Mesh(mergeGeometries(lamps), new THREE.MeshBasicMaterial({ color: COLORS.lamp })));
  return group;
}

/**
 * 吊り橋（レインボーブリッジのような白い橋）。2本の主塔と、塔の頂上を結んで垂れ下がる主ケーブル、
 * 主ケーブルから床へ下ろす細いケーブル。塔の頂上には赤い航空障害灯
 */
function buildSuspension(road: RoadModel, i0: number, i1: number, lowY: number): THREE.Group {
  const group = new THREE.Group();
  const length = (i1 - i0) * road.step;
  const a = frame(road, i0 % road.count);
  const deckY = a.y;
  // 橋の始まりから s [m]、中心から横へ w [m] の点（橋はまっすぐ）
  const at = (s: number, w: number, y: number) => new THREE.Vector3(a.x + a.fx * s + a.lx * w, y, a.z + a.fz * s + a.lz * w);
  const side = a.w / 2 + 2.2;
  const top = deckY + TOWER_HEIGHT;
  const towerS = [length * 0.22, length * 0.78];
  const towers: THREE.BufferGeometry[] = [];
  const cables: THREE.BufferGeometry[] = [];
  const lights: THREE.BufferGeometry[] = [];
  const yaw = Math.atan2(a.fx, a.fz);
  const box = (sx: number, sy: number, sz: number, p: THREE.Vector3) => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateY(yaw);
    g.translate(p.x, p.y, p.z);
    return g;
  };
  for (const s of towerS) {
    for (const w of [-side, side]) towers.push(box(2.4, top - lowY, 3, at(s, w, (top + lowY) / 2)));
    for (const y of [deckY - 3, deckY + 26, top - 4]) towers.push(box(side * 2, 2.6, 2.2, at(s, 0, y)));
    for (const w of [-side, side]) lights.push(box(0.8, 0.8, 0.8, at(s, w, top + 0.4)));
  }
  const rod = (p: THREE.Vector3, q: THREE.Vector3, r: number) => {
    const d = new THREE.Vector3().subVectors(q, p);
    const g = new THREE.CylinderGeometry(r, r, d.length(), 5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    const m = p.clone().add(q).multiplyScalar(0.5);
    g.translate(m.x, m.y, m.z);
    return g;
  };
  const deck = deckY + BARRIER_HEIGHT;
  const [s1, s2] = towerS;
  const cableY = (s: number) => {
    if (s <= s1) return deck + (top - deck) * Math.pow(s / s1, 1.3);
    if (s >= s2) return deck + (top - deck) * Math.pow((length - s) / (length - s2), 1.3);
    const u = (s - (s1 + s2) / 2) / ((s2 - s1) / 2);
    return deck + 3 + (top - deck - 3) * u * u;
  };
  const step = 8;
  for (const w of [-side, side]) {
    for (let s = 0; s < length; s += step) {
      const e = Math.min(length, s + step);
      cables.push(rod(at(s, w, cableY(s)), at(e, w, cableY(e)), 0.35));
    }
    for (let s = step; s < length; s += step) {
      if (Math.abs(s - s1) < 4 || Math.abs(s - s2) < 4) continue;
      cables.push(rod(at(s, w, deck), at(s, w, cableY(s)), 0.08));
    }
  }
  const mesh = (geos: THREE.BufferGeometry[], mat: THREE.Material) => {
    const m = new THREE.Mesh(mergeMixed(geos), mat);
    m.castShadow = true;
    group.add(m);
  };
  mesh(towers, new THREE.MeshLambertMaterial({ color: COLORS.bridgeWhite }));
  // ケーブルは夜も光って見えるよう、光の影響を受けない色にする
  mesh(cables, new THREE.MeshBasicMaterial({ color: COLORS.cable }));
  group.add(new THREE.Mesh(mergeMixed(lights), new THREE.MeshBasicMaterial({ color: COLORS.aviation })));
  return group;
}

/** 首都高の街灯（40m おきに左右交互） */
function buildLamps(road: RoadModel): THREE.Group {
  const group = new THREE.Group();
  const poles: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const height = 9;
  const every = Math.round(40 / road.step);
  for (let i = 0, n = 0; i < road.count; i += every, n++) {
    if (road.flags[i] & FLAG_SUSPENSION) continue;
    // トンネルの中と坑口のそばには立てない（天井や山を突き抜ける）
    const near = Math.round(8 / road.step);
    if ([-near, 0, near].some((d) => road.flags[road.closed ? (i + d + road.count) % road.count : Math.min(road.count - 1, Math.max(0, i + d))] & FLAG_TUNNEL)) continue;
    const f = frame(road, i);
    const side = n % 2 === 0 ? 1 : -1;
    const off = side * (f.w / 2 + 0.55);
    const bx = f.x + f.lx * off;
    const bz = f.z + f.lz * off;
    // 道路の内側へ向かう向き
    const ix = -f.lx * side;
    const iz = -f.lz * side;
    const pole = new THREE.CylinderGeometry(0.12, 0.16, height, 6);
    pole.translate(bx, f.y + BARRIER_HEIGHT + height / 2, bz);
    poles.push(pole);
    const yaw = Math.atan2(ix, iz);
    const arm = new THREE.BoxGeometry(0.14, 0.14, 2.2);
    arm.rotateY(yaw);
    arm.translate(bx + ix * 1.1, f.y + BARRIER_HEIGHT + height, bz + iz * 1.1);
    poles.push(arm);
    const lamp = new THREE.BoxGeometry(0.4, 0.18, 0.9);
    lamp.rotateY(yaw);
    lamp.translate(bx + ix * 2.2, f.y + BARRIER_HEIGHT + height - 0.15, bz + iz * 2.2);
    lamps.push(lamp);
  }
  if (poles.length) group.add(new THREE.Mesh(mergeMixed(poles), new THREE.MeshLambertMaterial({ color: 0x7d8186 })));
  if (lamps.length) group.add(new THREE.Mesh(mergeMixed(lamps), new THREE.MeshBasicMaterial({ color: COLORS.lamp })));
  return group;
}

/** 首都高の下の街（ビル）と海 */
function buildCity(road: RoadModel, lowY: number): THREE.Group {
  const group = new THREE.Group();
  const sea = road.spec.sea ?? [];
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
  const cityMat = new THREE.MeshLambertMaterial({ color: COLORS.city });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000).rotateX(-Math.PI / 2), cityMat);
  plane.position.set((minX + maxX) / 2, lowY - 0.05, (minZ + maxZ) / 2);
  plane.receiveShadow = true;
  group.add(plane);
  const inSea = (x: number, z: number, m = 0) => sea.some(([x0, z0, x1, z1]) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m);
  if (sea.length) {
    const water = sea.map(([x0, z0, x1, z1]) => {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, lowY + 0.05, (z0 + z1) / 2);
      return g;
    });
    const m = new THREE.Mesh(mergeGeometries(water), new THREE.MeshPhongMaterial({ color: COLORS.water, shininess: 60, specular: 0x406080 }));
    m.receiveShadow = true;
    group.add(m);
  }
  // ビル: 格子の升ごとに1棟。道路の近くと海には建てない
  const grid = new PointGrid(road.x, road.z);
  const cell = 34;
  const boxes: THREE.BufferGeometry[] = [];
  const colors = COLORS.buildings.map((c) => new THREE.Color(c));
  const glass = new THREE.Color(0x9fb3c8);
  const margin = 350;
  for (let x = Math.floor((minX - margin) / cell) * cell; x < maxX + margin; x += cell) {
    for (let z = Math.floor((minZ - margin) / cell) * cell; z < maxZ + margin; z += cell) {
      const ci = Math.round(x / cell);
      const cj = Math.round(z / cell);
      if (tileHash(ci, cj, 21) < 0.18) continue;
      const w = 12 + tileHash(ci, cj, 22) * 16;
      const d = 12 + tileHash(ci, cj, 23) * 16;
      const cx = x + (tileHash(ci, cj, 24) - 0.5) * (cell - w);
      const cz = z + (tileHash(ci, cj, 25) - 0.5) * (cell - d);
      const r = Math.hypot(w, d) / 2;
      if (inSea(cx, cz, r)) continue;
      const near = grid.near(cx, cz, r + 14);
      if (near.some((k) => Math.hypot(cx - road.x[k], cz - road.z[k]) < road.width[k] / 2 + r + 3)) continue;
      // 海から離れるほど高いビルが多い
      const tall = tileHash(ci, cj, 26);
      const height = 12 + tall * tall * 110;
      const g = new THREE.BoxGeometry(w, height, d).toNonIndexed();
      g.translate(cx, lowY + height / 2, cz);
      const color = tall > 0.8 ? glass : colors[Math.floor(tileHash(ci, cj, 27) * colors.length)];
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) color.toArray(col, v * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      boxes.push(g);
    }
  }
  if (boxes.length) {
    const m = new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
