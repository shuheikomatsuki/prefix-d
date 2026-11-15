import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BoxObstacle, MapObstacles } from '../map/obstacles';
import { type Shortcut, shortcutPoint } from '../map/shortcuts';
import { RAVINE_DEPTH, type Terrain } from '../map/terrain';
import { type ParsedMap, type Tile, DIR_OFFSET, roadShape, tileCenter } from '../map/tilemap';
import { CONE_HALF_SIZE } from '../sim/physics';
import { SignFactory } from './signs';
import { buildTrees } from './vegetation';
import { surfaceMaterial, worldUV } from './courseMaterials';
import { TEXTURE_METERS, noise2 } from './courseTextures';

export const COLORS = {
  grass: 0x7fb069,
  rock: 0x8a7f72,
  outside: 0x5f8a4f,
  road: 0x4a4e57,
  line: 0xf2f2f2,
  centerLine: 0xf2c94c,
  wall: 0xb8b8b0,
  outerWall: 0x8d8d86,
  trunk: 0x7a5236,
  leaves: 0x3f8f4a,
  cone: 0xff7a1a,
  buildings: [0xe8d8c3, 0xc9d6df, 0xf0c5a8, 0xd9d2e9],
  roof: 0x6b6f78,
  guardrail: 0xe6e8ea,
  guardrailPost: 0x8c9196,
  shortcut: 0xa9a59b,
  water: 0x2f6f9a,
  bank: 0x8a8478,
  city: 0x6b6d70,
  concrete: 0xc4c2bb,
  deck: 0x9a9890,
  lamp: 0xffc46b,
  tunnel: 0x77736b,
  bridgeWhite: 0xeef0f2,
  cable: 0xf6f6f2,
  aviation: 0xff3b30,
};

/** 川の水面の深さ（地面からの高さの差）[m] */
const WATER_DEPTH = 3;
/** 橋・高架の床の厚さ [m] */
const DECK_THICKNESS = 1.4;

const ROAD_Y = 0.01;
const LINE_Y = 0.02;

/** XZ 平面上の長方形（y は高さ） */
function flatRect(cx: number, cz: number, sx: number, sz: number, y: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate(cx, y, cz);
  return g;
}

/** 角 (cornerX, cornerZ) を中心に、タイル内側へ向かう 1/4 円弧の帯 */
function flatArc(
  cornerX: number,
  cornerZ: number,
  sx: number,
  sz: number,
  inner: number,
  outer: number,
  y: number,
): THREE.BufferGeometry {
  // RingGeometry は XY 平面。rotateX(-90°) で (x, y) → (x, 0, -y) になるので、
  // XZ 上の方向 (a, b) は XY 上の角度 atan2(-b, a) に対応する
  const diagonal = Math.atan2(sz, -sx);
  const g = new THREE.RingGeometry(inner, outer, 24, 1, diagonal - Math.PI / 4, Math.PI / 2);
  g.rotateX(-Math.PI / 2);
  g.translate(cornerX, y, cornerZ);
  return g;
}

function buildRoadGeometry(map: ParsedMap) {
  const { tileSize, roadWidth } = map.def;
  // 車線の境目（中央からのずれ）
  const dividers = [0];
  const half = tileSize / 2;
  const rw = roadWidth / 2;
  const road: THREE.BufferGeometry[] = [];
  const edgeLines: THREE.BufferGeometry[] = [];
  const centerLines: THREE.BufferGeometry[] = [];
  const lineW = 0.18;
  const edgeInset = 0.5;

  const addTile = (tile: Tile) => {
    const { x, z } = tileCenter(map, tile.col, tile.row);
    const shape = roadShape(tile);

    if (shape === 'curve') {
      const sx = tile.connections.includes('E') ? 1 : -1;
      const sz = tile.connections.includes('S') ? 1 : -1;
      const cx = x + sx * half;
      const cz = z + sz * half;
      road.push(flatArc(cx, cz, sx, sz, half - rw, half + rw, ROAD_Y));
      const inner = half - rw + edgeInset;
      const outer = half + rw - edgeInset;
      edgeLines.push(flatArc(cx, cz, sx, sz, inner - lineW / 2, inner + lineW / 2, LINE_Y));
      edgeLines.push(flatArc(cx, cz, sx, sz, outer - lineW / 2, outer + lineW / 2, LINE_Y));
      for (const d of dividers) centerLines.push(flatArc(cx, cz, sx, sz, half + d - lineW / 2, half + d + lineW / 2, LINE_Y));
      return;
    }

    // 中央の正方形 + つながっている方向への腕
    road.push(flatRect(x, z, roadWidth, roadWidth, ROAD_Y));
    const armLen = half - rw;
    for (const d of tile.connections) {
      const { dc, dr } = DIR_OFFSET[d];
      const ax = x + dc * (rw + armLen / 2);
      const az = z + dr * (rw + armLen / 2);
      road.push(flatRect(ax, az, dc ? armLen : roadWidth, dr ? armLen : roadWidth, ROAD_Y));
    }

    if (shape === 'straight') {
      const alongX = tile.connections.includes('E');
      const edge = rw - edgeInset;
      for (const s of [-1, 1]) {
        edgeLines.push(
          alongX
            ? flatRect(x, z + s * edge, tileSize, lineW, LINE_Y)
            : flatRect(x + s * edge, z, lineW, tileSize, LINE_Y),
        );
      }
      // 破線のセンターライン（車線の境目）
      for (const d of dividers) {
        for (const offset of [-half / 2, half / 2]) {
          centerLines.push(
            alongX
              ? flatRect(x + offset, z + d, 4, lineW, LINE_Y)
              : flatRect(x + d, z + offset, lineW, 4, LINE_Y),
          );
        }
      }
    }
  };

  for (const tile of map.tiles) if (tile.kind === 'road') addTile(tile);

  return {
    road: mergeGeometries(road),
    edgeLines: edgeLines.length ? mergeGeometries(edgeLines) : null,
    centerLines: centerLines.length ? mergeGeometries(centerLines) : null,
  };
}

/** 平らに作ったジオメトリ（ワールド座標）の各頂点を、地形の高さだけ持ち上げる */
function liftGeometry(g: THREE.BufferGeometry, terrain: Terrain): THREE.BufferGeometry {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + terrain.heightAt(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * 地形の格子をそのままメッシュにする。tint を渡すと、頂点ごとの色（急なほど 1 の steep で草と岩を混ぜた色）を
 * その場所に合わせて変えられる
 */
export function terrainGeometry(terrain: Pick<Terrain, 'grid'>, tint?: (x: number, z: number, steep: number, color: THREE.Color) => void): THREE.BufferGeometry {
  const { minX, minZ, step, nx, nz, ground } = terrain.grid;
  const w = (nx - 1) * step;
  const d = (nz - 1) * step;
  const g = new THREE.PlaneGeometry(w, d, nx - 1, nz - 1);
  g.rotateX(-Math.PI / 2);
  g.translate(minX + w / 2, 0, minZ + d / 2);
  // PlaneGeometry の頂点は、回転後に x が小さい順・z が小さい順に並ぶ
  const pos = g.attributes.position;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) pos.setY(j * nx + i, ground[j * nx + i]);
  }
  g.computeVertexNormals();
  // 急な斜面（道路の外の崖）は岩の色にして、落ちる場所だとわかるようにする
  const normal = g.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  const grass = new THREE.Color(COLORS.grass);
  const rock = new THREE.Color(COLORS.rock);
  const c = new THREE.Color();
  for (let k = 0; k < normal.count; k++) {
    const steep = Math.min(1, Math.max(0, (0.93 - normal.getY(k)) / 0.2));
    c.copy(grass).lerp(rock, steep);
    // 数十 m の大きさのムラ（草の濃い所・枯れた所）で、同じ模様のくり返しを目立たなくする
    const x = pos.getX(k);
    const z = pos.getZ(k);
    c.multiplyScalar(0.86 + noise2(x / 45, z / 45, 71) * 0.2 + noise2(x / 11, z / 11, 72) * 0.08);
    tint?.(x, z, steep, c);
    c.toArray(colors, k * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return worldUV(g, TEXTURE_METERS.ground);
}

export function buildMapMesh(map: ParsedMap, obstacles: MapObstacles, terrain: Terrain | null = null): THREE.Group {
  const group = new THREE.Group();
  const heightAt = (x: number, z: number) => (terrain ? terrain.heightAt(x, z) : 0);
  const lift = (g: THREE.BufferGeometry) => (terrain ? liftGeometry(g, terrain) : g);
  const { tileSize } = map.def;
  const half = tileSize / 2;
  const width = map.cols * tileSize;
  const depth = map.rows * tileSize;
  const centerX = width / 2 - half;
  const centerZ = depth / 2 - half;

  // 外側の地面と、マップ内の草地。川のあるマップは水の所に穴をあける
  const hasWater = map.tiles.some((t) => t.kind === 'water' || t.bridge);
  const lowY = -WATER_DEPTH;
  const outsideY = terrain ? terrain.grid.ground.reduce((a, b) => Math.min(a, b), Infinity) - 2 : -0.02;
  const outsideMat = new THREE.MeshLambertMaterial({ color: COLORS.outside });
  if (hasWater && !terrain) {
    // マップの周りだけを囲む（水面を覆わないように）
    const big = 2000;
    for (const [cx, cz, sx, sz] of [
      [centerX, centerZ - depth / 2 - big / 2, big + width, big],
      [centerX, centerZ + depth / 2 + big / 2, big + width, big],
      [centerX - width / 2 - big / 2, centerZ, big, depth],
      [centerX + width / 2 + big / 2, centerZ, big, depth],
    ]) {
      const m = new THREE.Mesh(flatRect(cx, cz, sx, sz, outsideY), outsideMat);
      m.receiveShadow = true;
      group.add(m);
    }
  } else {
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2), outsideMat);
    outside.position.set(centerX, outsideY, centerZ);
    outside.receiveShadow = true;
    group.add(outside);
  }

  const isWet = (t: Tile | undefined) => t !== undefined && (t.kind === 'water' || t.bridge);
  let grassGeo: THREE.BufferGeometry;
  if (terrain) grassGeo = terrainGeometry(terrain);
  else if (hasWater) {
    grassGeo = mergeGeometries(
      map.tiles.filter((t) => !isWet(t)).map((t) => {
        const c = tileCenter(map, t.col, t.row);
        return flatRect(c.x, c.z, tileSize, tileSize, 0);
      }),
    );
  } else grassGeo = flatRect(centerX, centerZ, width, depth, 0);
  if (!terrain) worldUV(grassGeo, TEXTURE_METERS.ground);
  const grass = new THREE.Mesh(
    grassGeo,
    terrain
      ? surfaceMaterial('ground', { vertexColors: true })
      : surfaceMaterial('ground', { color: COLORS.grass }),
  );
  grass.receiveShadow = true;
  group.add(grass);
  if (!terrain && hasWater) group.add(buildWaterAndDecks(map, lowY, isWet));
  if (terrain && hasWater) group.add(buildRavineBridges(map, terrain, isWet));
  if (map.tiles.some((t) => t.tunnel)) group.add(buildTunnels(map, terrain));

  // 道路と白線
  const roads = buildRoadGeometry(map);
  worldUV(lift(roads.road), TEXTURE_METERS.asphalt);
  if (roads.edgeLines) worldUV(lift(roads.edgeLines), TEXTURE_METERS.paint);
  if (roads.centerLines) worldUV(lift(roads.centerLines), TEXTURE_METERS.paint);
  // 草地・道路・白線は高さの差が小さいので、材質の layer（ポリゴンオフセット）で手前に描いてちらつきを防ぐ
  const roadMesh = new THREE.Mesh(
    roads.road,
    surfaceMaterial('asphalt', { color: COLORS.road, layer: 1 }),
  );
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  if (roads.edgeLines) {
    group.add(
      new THREE.Mesh(roads.edgeLines, surfaceMaterial('paint', { color: COLORS.line, layer: 2 })),
    );
  }
  if (roads.centerLines) {
    group.add(
      new THREE.Mesh(roads.centerLines, surfaceMaterial('paint', { color: COLORS.centerLine, layer: 2 })),
    );
  }

  // 建物・壁
  const roofMat = new THREE.MeshLambertMaterial({ color: COLORS.roof });
  const buildingMats = COLORS.buildings.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const wallMats = [
    new THREE.MeshLambertMaterial({ color: COLORS.wall }),
    new THREE.MeshLambertMaterial({ color: COLORS.outerWall }),
  ];
  const railMat = new THREE.MeshLambertMaterial({ color: COLORS.guardrail });
  const postMat = new THREE.MeshLambertMaterial({ color: COLORS.guardrailPost });
  const barriers: THREE.BufferGeometry[] = [];
  for (const b of obstacles.boxes) {
    if (b.kind === 'guardrail') {
      group.add(createGuardrail(b, railMat, postMat, terrain));
      continue;
    }
    if (b.kind === 'barrier') {
      const g = new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2);
      g.rotateY(b.yaw ?? 0);
      g.translate(b.x, b.y, b.z);
      barriers.push(g);
      continue;
    }
    const mat = b.kind === 'building' ? buildingMats[b.variant % buildingMats.length] : wallMats[b.variant];
    if (b.kind === 'wall' && terrain) {
      // 長い壁は、地形に沿うよう短く区切って並べる
      for (const part of splitWall(b)) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(part.hx * 2, part.hy * 2 + 4, part.hz * 2), mat);
        mesh.position.set(part.x, part.y - 2 + heightAt(part.x, part.z), part.z);
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      continue;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2, b.hy * 2, b.hz * 2), mat);
    mesh.position.set(b.x, b.y + heightAt(b.x, b.z), b.z);
    mesh.rotation.y = b.yaw ?? 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (b.kind === 'building') {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.4, 0.4, b.hz * 2 + 0.4), roofMat);
      roof.position.set(b.x, b.y + b.hy + 0.2 + heightAt(b.x, b.z), b.z);
      roof.castShadow = true;
      group.add(roof);
    }
  }

  if (barriers.length) {
    const mesh = new THREE.Mesh(worldUV(lift(mergeGeometries(barriers)), TEXTURE_METERS.concrete), surfaceMaterial('concrete', { color: COLORS.concrete }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // 木（坂の上でも浮かないよう、根元を少し埋める）
  group.add(buildTrees(obstacles.trees, (x, z) => (terrain ? heightAt(x, z) : 0.5)));

  const signs = new SignFactory();
  for (const sign of obstacles.signs) {
    const mesh = signs.create(sign);
    mesh.position.y += heightAt(sign.x, sign.z);
    group.add(mesh);
  }

  return group;
}

/** 角 (cornerX, cornerZ) を中心にした 1/4 円弧の板（カーブの橋・高架の床）。上面が top */
function arcSlab(cornerX: number, cornerZ: number, sx: number, sz: number, inner: number, outer: number, top: number, thickness: number): THREE.BufferGeometry {
  // flatArc と同じ角度の範囲を XY 平面で作り、厚さの向き（+Z）を上（+Y）に向ける
  const a0 = Math.atan2(sz, -sx) - Math.PI / 4;
  const a1 = a0 + Math.PI / 2;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, a0, a1, false);
  shape.absarc(0, 0, inner, a1, a0, true);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 16 });
  g.rotateX(-Math.PI / 2);
  g.translate(cornerX, top - thickness, cornerZ);
  return g;
}

/** 水面・川岸と、橋の床と柱。lowY は水面の下の地面の高さ */
function buildWaterAndDecks(map: ParsedMap, lowY: number, isWet: (t: Tile | undefined) => boolean): THREE.Group {
  const group = new THREE.Group();
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const water: THREE.BufferGeometry[] = [];
  const banks: THREE.BufferGeometry[] = [];
  const decks: THREE.BufferGeometry[] = [];
  const pillars: THREE.BufferGeometry[] = [];
  const deckHalf = roadWidth / 2 + 1;
  const deckTop = -0.03;
  for (const t of map.tiles) {
    const { x, z } = tileCenter(map, t.col, t.row);
    if (isWet(t)) {
      water.push(flatRect(x, z, tileSize, tileSize, lowY + 0.6));
      // 陸との境目の岸（縦の面）
      for (const { dc, dr } of Object.values(DIR_OFFSET)) {
        if (isWet(map.tileAt(t.col + dc, t.row + dr))) continue;
        const g = new THREE.PlaneGeometry(tileSize, -lowY);
        if (dc !== 0) g.rotateY(Math.PI / 2);
        g.translate(x + dc * half, lowY / 2, z + dr * half);
        banks.push(g);
      }
    }
    if (t.kind !== 'road' || !t.bridge) continue;
    const pillarH = deckTop - DECK_THICKNESS - lowY;
    let px = x;
    let pz = z;
    if (roadShape(t) === 'curve') {
      const sx = t.connections.includes('E') ? 1 : -1;
      const sz = t.connections.includes('S') ? 1 : -1;
      decks.push(arcSlab(x + sx * half, z + sz * half, sx, sz, half - deckHalf, half + deckHalf, deckTop, DECK_THICKNESS));
      px = x + sx * half - sx * half * Math.SQRT1_2;
      pz = z + sz * half - sz * half * Math.SQRT1_2;
    } else {
      const alongX = t.connections.includes('E') || t.connections.includes('W');
      const g = new THREE.BoxGeometry(alongX ? tileSize : deckHalf * 2, DECK_THICKNESS, alongX ? deckHalf * 2 : tileSize);
      g.translate(x, deckTop - DECK_THICKNESS / 2, z);
      decks.push(g);
    }
    const p = new THREE.CylinderGeometry(1.1, 1.3, pillarH, 10);
    p.translate(px, lowY + pillarH / 2, pz);
    pillars.push(p);
  }
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) => {
    if (!geos.length) return;
    // 押し出した板（インデックスなし）と箱（インデックスあり）を混ぜるので、そろえてからまとめる
    const mesh = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    group.add(mesh);
  };
  add(water, new THREE.MeshPhongMaterial({ color: COLORS.water, shininess: 40, specular: 0x30485a }), false);
  add(banks, new THREE.MeshLambertMaterial({ color: COLORS.bank, side: THREE.DoubleSide }), false);
  add(decks, new THREE.MeshLambertMaterial({ color: COLORS.deck }));
  add(pillars, new THREE.MeshLambertMaterial({ color: COLORS.deck }));
  return group;
}

/** ガードレール: 衝突体は箱だが、見た目は帯状のレールと支柱にする */
function createGuardrail(b: BoxObstacle, railMat: THREE.Material, postMat: THREE.Material, terrain: Terrain | null): THREE.Group {
  const g = new THREE.Group();
  const yaw = b.yaw ?? 0;
  if (terrain) {
    // 両端の高さの差だけ、長さの方向（ローカル +Z）に傾ける
    const fx = Math.sin(yaw) * b.hz;
    const fz = Math.cos(yaw) * b.hz;
    const front = terrain.heightAt(b.x + fx, b.z + fz);
    const back = terrain.heightAt(b.x - fx, b.z - fz);
    g.position.set(b.x, (front + back) / 2, b.z);
    g.rotation.set(-Math.atan2(front - back, b.hz * 2), yaw, 0, 'YXZ');
  } else {
    g.position.set(b.x, 0, b.z);
    g.rotation.y = yaw;
  }
  const top = b.hy * 2;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.32, b.hz * 2), railMat);
  rail.position.y = top - 0.22;
  rail.castShadow = true;
  g.add(rail);
  for (const z of [-b.hz * 0.85, b.hz * 0.85]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, top, 6), postMat);
    post.position.set(-0.08, top / 2, z);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}

/** タイルの道路の中心線を step [m] ごとに区切った点と進む向き。つながっている2方向の一方からもう一方へ進む */
function tilePath(map: ParsedMap, tile: Tile, step: number): { x: number; z: number; tx: number; tz: number }[] {
  const half = map.def.tileSize / 2;
  const { x, z } = tileCenter(map, tile.col, tile.row);
  const [da, db] = tile.connections.length === 2 ? tile.connections : [tile.connections[0], tile.connections[0]];
  const a = DIR_OFFSET[da];
  const b = DIR_OFFSET[db];
  const points: { x: number; z: number; tx: number; tz: number }[] = [];
  if (a.dc === -b.dc && a.dr === -b.dr) {
    // 直線: a の縁から b の縁へ
    const n = Math.max(1, Math.round((2 * half) / step));
    for (let i = 0; i <= n; i++) {
      const u = half - (2 * half * i) / n;
      points.push({ x: x + a.dc * u, z: z + a.dr * u, tx: b.dc, tz: b.dr });
    }
    return points;
  }
  // カーブ: タイルの角を中心とする 1/4 円
  const cx = x + (a.dc + b.dc) * half;
  const cz = z + (a.dr + b.dr) * half;
  const th0 = Math.atan2(z + a.dr * half - cz, x + a.dc * half - cx);
  let th1 = Math.atan2(z + b.dr * half - cz, x + b.dc * half - cx);
  if (th1 - th0 > Math.PI) th1 -= 2 * Math.PI;
  if (th0 - th1 > Math.PI) th1 += 2 * Math.PI;
  const sign = Math.sign(th1 - th0);
  const n = Math.max(2, Math.round(((Math.PI / 2) * half) / step));
  for (let i = 0; i <= n; i++) {
    const th = th0 + ((th1 - th0) * i) / n;
    points.push({ x: cx + half * Math.cos(th), z: cz + half * Math.sin(th), tx: -Math.sin(th) * sign, tz: Math.cos(th) * sign });
  }
  return points;
}

/** 4方向でつながったタイルのまとまり */
function tileGroups(map: ParsedMap, member: (t: Tile) => boolean): Tile[][] {
  const seen = new Set<Tile>();
  const groups: Tile[][] = [];
  for (const start of map.tiles) {
    if (seen.has(start) || !member(start)) continue;
    const group: Tile[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const t = stack.pop()!;
      group.push(t);
      for (const { dc, dr } of Object.values(DIR_OFFSET)) {
        const next = map.tileAt(t.col + dc, t.row + dr);
        if (next && !seen.has(next) && member(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/** インデックスあり・なしのジオメトリをそろえてまとめる */
export function mergeMixed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/**
 * 高低差のあるマップの橋: 谷に架かる床と高い橋脚、谷の底の川。
 * 川の水面は、つながった谷（橋と川のタイル）ごとに、いちばん低い橋の下の谷の底の少し上にそろえる
 */
function buildRavineBridges(map: ParsedMap, terrain: Terrain, isWet: (t: Tile | undefined) => boolean): THREE.Group {
  const group = new THREE.Group();
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const deckHalf = roadWidth / 2 + 1;
  const deckTop = -0.03;
  const decks: THREE.BufferGeometry[] = [];
  const pillars: THREE.BufferGeometry[] = [];
  const water: THREE.BufferGeometry[] = [];
  for (const t of map.tiles) {
    if (!t.bridge) continue;
    const { x, z } = tileCenter(map, t.col, t.row);
    let px = x;
    let pz = z;
    if (roadShape(t) === 'curve') {
      const sx = t.connections.includes('E') ? 1 : -1;
      const sz = t.connections.includes('S') ? 1 : -1;
      decks.push(liftGeometry(arcSlab(x + sx * half, z + sz * half, sx, sz, half - deckHalf, half + deckHalf, deckTop, DECK_THICKNESS), terrain));
      px = x + sx * half - sx * half * Math.SQRT1_2;
      pz = z + sz * half - sz * half * Math.SQRT1_2;
    } else {
      const alongX = t.connections.includes('E') || t.connections.includes('W');
      // 坂に沿わせるため、長い方向を細かく区切る
      const g = new THREE.BoxGeometry(alongX ? tileSize : deckHalf * 2, DECK_THICKNESS, alongX ? deckHalf * 2 : tileSize, alongX ? 8 : 1, 1, alongX ? 1 : 8);
      g.translate(x, deckTop - DECK_THICKNESS / 2, z);
      decks.push(liftGeometry(g, terrain));
    }
    const top = terrain.heightAt(px, pz) + deckTop - DECK_THICKNESS;
    const bottom = terrain.groundAt(px, pz) - 2;
    if (top - bottom > 2) {
      const p = new THREE.BoxGeometry(3, top - bottom, 4.5);
      if (roadShape(t) === 'straight' && (t.connections.includes('N') || t.connections.includes('S'))) p.rotateY(Math.PI / 2);
      p.translate(px, (top + bottom) / 2, pz);
      pillars.push(p);
    }
  }
  for (const tiles of tileGroups(map, isWet)) {
    const bridges = tiles.filter((t) => t.bridge);
    if (!bridges.length) continue;
    const level = Math.min(...bridges.map((t) => {
      const c = tileCenter(map, t.col, t.row);
      return terrain.heightAt(c.x, c.z);
    })) - RAVINE_DEPTH + 3;
    for (const t of tiles) {
      const c = tileCenter(map, t.col, t.row);
      water.push(flatRect(c.x, c.z, tileSize, tileSize, level));
    }
  }
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean) => {
    if (!geos.length) return;
    const mesh = new THREE.Mesh(mergeMixed(geos), mat);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    group.add(mesh);
  };
  add(water, new THREE.MeshPhongMaterial({ color: COLORS.water, shininess: 40, specular: 0x30485a }), false);
  add(decks, new THREE.MeshLambertMaterial({ color: COLORS.deck }), true);
  add(pillars, new THREE.MeshLambertMaterial({ color: COLORS.deck }), true);
  return group;
}

/** トンネルの中の断面（道路の中心からの横 u・道路からの高さ v）。壁と半円のアーチ */
function tunnelProfile(halfWidth: number, wall: number, arch: number): [number, number][] {
  const points: [number, number][] = [[-halfWidth, -0.5]];
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * (1 - k / 10);
    points.push([halfWidth * Math.cos(a), wall + arch * Math.sin(a)]);
  }
  points.push([halfWidth, -0.5]);
  return points;
}

/**
 * トンネル: 道路を覆う山（外側の土の盛り上がり）と、中のコンクリートの壁・天井、出入り口の坑口、天井の照明。
 * トンネルのタイルごとに、中心線に沿って断面をつないで作る
 */
function buildTunnels(map: ParsedMap, terrain: Terrain | null): THREE.Group {
  const group = new THREE.Group();
  const { tileSize, roadWidth } = map.def;
  const half = tileSize / 2;
  const heightAt = (x: number, z: number) => (terrain ? terrain.heightAt(x, z) : 0);
  const tw = roadWidth / 2 + 0.9;
  const inner = tunnelProfile(tw, 4.2, 3.2);
  const frame = tunnelProfile(tw + 1.4, 4.2, 4.6);
  // 外側の山: 中と同じ数の点で、横はタイルの半分近くまで、高さは道路から 15m。裾は崖の下へ広げる
  const mound = Math.min(half - 1, tw + 9);
  const outer: [number, number][] = [[-mound - 10, -18]];
  for (let k = 0; k <= 10; k++) {
    const a = Math.PI * (1 - k / 10);
    outer.push([mound * Math.cos(a), 1 + 14 * Math.pow(Math.sin(a), 0.8)]);
  }
  outer.push([mound + 10, -18]);
  const floor: [number, number][] = [
    [-tw, 0.02],
    [-roadWidth / 2, 0.02],
    [roadWidth / 2, 0.02],
    [tw, 0.02],
  ];
  const floorL = [0, 1];
  const floorR = [2, 3];

  const earth: number[] = [];
  const wall: number[] = [];
  const portal: number[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  type V = [number, number, number];
  /** 三角形を、法線が ref から離れる向き（out = true）か ref へ向かう向きになるよう並べて加える */
  const tri = (out: number[], a: V, b: V, c: V, ref: V, outward: boolean) => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const dot = nx * ((a[0] + b[0] + c[0]) / 3 - ref[0]) + ny * ((a[1] + b[1] + c[1]) / 3 - ref[1]) + nz * ((a[2] + b[2] + c[2]) / 3 - ref[2]);
    if (dot >= 0 === outward) out.push(...a, ...b, ...c);
    else out.push(...a, ...c, ...b);
  };
  const quad = (out: number[], a: V, b: V, c: V, d: V, ref: V, outward: boolean) => {
    tri(out, a, b, c, ref, outward);
    tri(out, a, c, d, ref, outward);
  };

  for (const tile of map.tiles) {
    if (!tile.tunnel || tile.connections.length === 0) continue;
    const path = tilePath(map, tile, 2);
    const rings = path.map((p) => {
      const y = heightAt(p.x, p.z);
      const lx = p.tz;
      const lz = -p.tx;
      const ring = (profile: [number, number][]) => profile.map(([u, v]): V => [p.x + lx * u, y + v, p.z + lz * u]);
      return { inner: ring(inner), frame: ring(frame), outer: ring(outer), floor: ring(floor), axis: [p.x, y + 4, p.z] as V, p, y };
    });
    for (let i = 0; i + 1 < rings.length; i++) {
      const r0 = rings[i];
      const r1 = rings[i + 1];
      for (let k = 0; k + 1 < inner.length; k++) {
        // 中の壁は軸へ向け、外の山は軸から外へ向ける
        quad(wall, r0.inner[k], r0.inner[k + 1], r1.inner[k + 1], r1.inner[k], r0.axis, false);
        quad(earth, r0.outer[k], r0.outer[k + 1], r1.outer[k + 1], r1.outer[k], r0.axis, true);
      }
      // 道路の端から壁までの床（草地が見えないように）
      for (const [a, b] of [floorL, floorR]) {
        quad(wall, r0.floor[a], r0.floor[b], r1.floor[b], r1.floor[a], r0.axis, false);
      }
    }
    // 天井の照明（10m おき）
    for (let i = 0; i < rings.length; i += 5) {
      const { p, y } = rings[i];
      const lamp = new THREE.BoxGeometry(0.5, 0.15, 1.6);
      lamp.rotateY(Math.atan2(p.tx, p.tz));
      lamp.translate(p.x, y + 4.2 + 3.2 - 0.25, p.z);
      lamps.push(lamp);
    }
    // 出入り口（となりがトンネルでない道路）の坑口
    const ends = [
      { ring: rings[0], dir: tile.connections[0], away: -1 },
      { ring: rings[rings.length - 1], dir: tile.connections[1] ?? tile.connections[0], away: 1 },
    ];
    for (const { ring, dir, away } of ends) {
      const { dc, dr } = DIR_OFFSET[dir];
      const next = map.tileAt(tile.col + dc, tile.row + dr);
      if (!next || next.kind !== 'road' || next.tunnel) continue;
      // 面の法線がトンネルの外を向くよう、少し外側の点を基準にする（ref から離れる向き = 外）
      const ref: V = [ring.p.x - ring.p.tx * away * 5, ring.y + 4, ring.p.z - ring.p.tz * away * 5];
      for (let k = 0; k + 1 < inner.length; k++) {
        quad(portal, ring.inner[k], ring.inner[k + 1], ring.frame[k + 1], ring.frame[k], ref, true);
        quad(earth, ring.frame[k], ring.frame[k + 1], ring.outer[k + 1], ring.outer[k], ref, true);
      }
    }
  }

  const geometry = (positions: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  };
  // 山は地形と同じく、上は草、急な所は岩の色
  const earthGeo = geometry(earth);
  const normal = earthGeo.attributes.normal;
  const colors = new Float32Array(normal.count * 3);
  const grass = new THREE.Color(COLORS.grass);
  const rock = new THREE.Color(COLORS.rock);
  const c = new THREE.Color();
  for (let k = 0; k < normal.count; k++) {
    const steep = Math.min(1, Math.max(0, (0.8 - normal.getY(k)) / 0.3));
    c.copy(grass).lerp(rock, steep).toArray(colors, k * 3);
  }
  earthGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  mesh(earthGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh(geometry(wall), new THREE.MeshLambertMaterial({ color: COLORS.tunnel, side: THREE.DoubleSide }));
  if (portal.length) mesh(geometry(portal), new THREE.MeshLambertMaterial({ color: COLORS.concrete, side: THREE.DoubleSide }));
  if (lamps.length) group.add(new THREE.Mesh(mergeGeometries(lamps), new THREE.MeshBasicMaterial({ color: COLORS.lamp })));
  return group;
}

/** 壁の箱を長い方向に約 8m ずつ区切る */
function splitWall(b: BoxObstacle): BoxObstacle[] {
  const alongX = b.hx > b.hz;
  const len = (alongX ? b.hx : b.hz) * 2;
  const n = Math.max(1, Math.round(len / 8));
  const part = len / n;
  return Array.from({ length: n }, (_, i) => {
    const offset = -len / 2 + part * (i + 0.5);
    return alongX
      ? { ...b, x: b.x + offset, hx: part / 2 + 0.05 }
      : { ...b, z: b.z + offset, hz: part / 2 + 0.05 };
  });
}

/** コーン（動く小物）のメッシュ。位置は毎フレーム物理から同期する */
/**
 * ヘアピンの内側の近道の帯（コンクリートの面）。地形に沿わせ、道路と重なる所は描かない
 */
export function buildShortcutMesh(shortcuts: readonly Shortcut[], heightAt: (x: number, z: number) => number, onRoad: (x: number, z: number) => boolean): THREE.Mesh {
  const STEP = 1;
  const positions: number[] = [];
  for (const sc of shortcuts) {
    const nu = Math.ceil((2 * sc.uMax) / STEP);
    const nw = Math.ceil((sc.wMax - sc.wMin) / STEP);
    const point = (i: number, j: number) => {
      const p = shortcutPoint(sc, -sc.uMax + (2 * sc.uMax * i) / nu, sc.wMin + ((sc.wMax - sc.wMin) * j) / nw);
      return [p.x, heightAt(p.x, p.z) + 0.02, p.z];
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nw; j++) {
        const c = shortcutPoint(sc, -sc.uMax + (2 * sc.uMax * (i + 0.5)) / nu, sc.wMin + ((sc.wMax - sc.wMin) * (j + 0.5)) / nw);
        if (onRoad(c.x, c.z)) continue;
        const a = point(i, j);
        const b = point(i + 1, j);
        const d = point(i, j + 1);
        const e = point(i + 1, j + 1);
        positions.push(...a, ...b, ...e, ...a, ...e, ...d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  // 三角形の向きは帯の向きで変わるので、両面を描く
  const mesh = new THREE.Mesh(
    g,
    new THREE.MeshLambertMaterial({ color: COLORS.shortcut, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -0.5 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

export function createConeMesh(): THREE.Mesh {
  const { radius, height } = CONE_HALF_SIZE;
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, height * 2, 12),
    new THREE.MeshLambertMaterial({ color: COLORS.cone }),
  );
  mesh.castShadow = true;
  return mesh;
}
