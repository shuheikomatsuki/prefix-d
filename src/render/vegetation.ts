import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TreeObstacle } from '../map/obstacles';
import type { Undergrowth } from '../map/roadside';
import { hash2 } from './courseTextures';

/**
 * 木と下草の見た目。同じ形を何本も描くので、形ごとに 1 つの InstancedMesh にまとめて（位置・向き・大きさ・色だけ
 * 変えて）描く。木は杉（円すいを何段も重ねた細長い形）と広葉樹（丸い葉の塊をいくつか集めた形）を混ぜる
 */

/** 頂点を少しずつずらして、きれいすぎる形をでこぼこにする（同じ位置の頂点は同じだけずらす） */
function jitter(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = (v: number) => Math.round(v * 1000);
    const k = (a: number) => (hash2(key(x) + a, key(y) * 3 + key(z), seed) - 0.5) * 2 * amount;
    p.setXYZ(i, x + k(1), y + k(2) * 0.5, z + k(3));
  }
  return g;
}

/** 頂点の色: 下（内側）ほど暗く、上ほど明るい（葉の重なりの陰） */
function shade(g: THREE.BufferGeometry, bottom: number, top: number, dark: number, center?: THREE.Vector3, radius = 1): THREE.BufferGeometry {
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let t = Math.max(0, Math.min(1, (p.getY(i) - bottom) / (top - bottom)));
    if (center) {
      // 塊の外側ほど明るい
      const d = Math.hypot(p.getX(i) - center.x, p.getZ(i) - center.z) / radius;
      t = t * 0.6 + Math.min(1, d) * 0.4;
    }
    const v = dark + (1 - dark) * t;
    colors.set([v, v, v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** 杉の葉（高さ 1 に正規化。根元が原点）。variant で段の数と太さを変える */
function cedarFoliage(variant: number): THREE.BufferGeometry {
  const tiers = 4 + variant;
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const r = (0.2 - variant * 0.015) * (1 - t * 0.75);
    const h = 0.26 - t * 0.06;
    const y = 0.3 + t * 0.58;
    const cone = new THREE.ConeGeometry(r, h, 9, 1, true).toNonIndexed();
    // 段ごとに少し回して、枝先の位置をずらす
    cone.rotateY(k * 0.7);
    cone.translate(0, y + h / 2, 0);
    parts.push(shade(jitter(cone, r * 0.12, 90 + k + variant * 10), y, y + h, 0.55));
  }
  return mergeGeometries(parts);
}

/** 広葉樹の葉（高さ 1 に正規化）。丸い葉の塊をいくつか集める */
function broadleafFoliage(variant: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blobs = 6 + variant;
  const center = new THREE.Vector3(0, 0.66, 0);
  for (let k = 0; k < blobs; k++) {
    const a = (k / blobs) * Math.PI * 2 + variant;
    const ring = k === 0 ? 0 : 0.12 + hash2(k, variant, 81) * 0.08;
    const r = 0.13 + hash2(k, variant, 82) * 0.07;
    const blob = new THREE.IcosahedronGeometry(r, 1);
    blob.scale(1, 0.85, 1);
    blob.translate(Math.cos(a) * ring, center.y + (hash2(k, variant, 83) - 0.4) * 0.2 + (k === 0 ? 0.08 : 0), Math.sin(a) * ring);
    parts.push(jitter(blob, r * 0.18, 84 + k + variant * 10));
  }
  return shade(mergeGeometries(parts), 0.45, 0.9, 0.5, center, 0.3);
}

/** 幹（高さ 1・半径 1 に正規化。上ほど細い） */
function trunk(): THREE.BufferGeometry {
  return shade(new THREE.CylinderGeometry(0.55, 1, 1, 7, 1).translate(0, 0.5, 0).toNonIndexed(), 0, 1, 0.7);
}

const CEDAR = 0x2f5e34;
const BROADLEAF = 0x4f8a3a;
const TRUNK = 0x6b4d36;

/** 木の種類（場所から決まる）: 杉が多く、ところどころに広葉樹 */
export function treeKind(t: TreeObstacle): { broadleaf: boolean; variant: number } {
  const ix = Math.round(t.x * 10);
  const iz = Math.round(t.z * 10);
  return { broadleaf: hash2(ix, iz, 85) < 0.32, variant: Math.floor(hash2(ix, iz, 86) * 3) };
}

/**
 * 木を描く。baseY はその木の根元の高さ。幹は地面に少し埋める
 */
export function buildTrees(trees: readonly TreeObstacle[], baseY: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  if (!trees.length) return group;
  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, envMapIntensity: 0.3 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: TRUNK, vertexColors: true, roughness: 0.95, envMapIntensity: 0.2 });
  // 種類ごとに置く木を分ける
  const buckets = new Map<string, TreeObstacle[]>();
  for (const t of trees) {
    const k = treeKind(t);
    const key = `${k.broadleaf ? 'b' : 'c'}${k.variant}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(t);
  }
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const trunkMesh = new THREE.InstancedMesh(trunk(), trunkMat, trees.length);
  let n = 0;
  for (const [key, list] of buckets) {
    const broadleaf = key[0] === 'b';
    const variant = Number(key.slice(1));
    const geo = broadleaf ? broadleafFoliage(variant) : cedarFoliage(variant);
    const mesh = new THREE.InstancedMesh(geo, foliageMat, list.length);
    list.forEach((t, i) => {
      const y = baseY(t.x, t.z) - 0.5;
      const h = t.height * (broadleaf ? 0.85 : 1.05);
      // 杉は細長く、広葉樹は横に広い
      const w = h * (broadleaf ? 1.05 : 0.95) * (0.9 + hash2(i, variant, 87) * 0.25);
      q.setFromAxisAngle(up, hash2(Math.round(t.x), Math.round(t.z), 88) * Math.PI * 2);
      mesh.setMatrixAt(i, m.compose(pos.set(t.x, y, t.z), q, scale.set(w, h, w)));
      const base = broadleaf ? BROADLEAF : CEDAR;
      const v = 0.85 + hash2(Math.round(t.x * 3), Math.round(t.z * 3), 89) * 0.3;
      color.setHex(base).multiplyScalar(v);
      // 広葉樹はところどころ黄色っぽい
      if (broadleaf) color.lerp(new THREE.Color(0x8a9a3a), hash2(Math.round(t.x), Math.round(t.z), 90) * 0.35);
      mesh.setColorAt(i, color);
      const th = h * (broadleaf ? 0.55 : 0.4);
      trunkMesh.setMatrixAt(n, m.compose(pos.set(t.x, y, t.z), q, scale.set(t.trunkRadius * 0.8, th, t.trunkRadius * 0.8)));
      trunkMesh.setColorAt(n, color.setScalar(0.85 + hash2(n, 0, 91) * 0.3));
      n++;
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  trunkMesh.castShadow = true;
  trunkMesh.receiveShadow = true;
  trunkMesh.computeBoundingSphere();
  group.add(trunkMesh);
  return group;
}

/** 草の葉の画像（下から伸びる細い葉。透けた所は描かない） */
function grassTexture(): THREE.DataTexture {
  const w = 64;
  const h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let b = 0; b < 26; b++) {
    const x0 = 4 + hash2(b, 1, 92) * (w - 8);
    const lean = (hash2(b, 2, 92) - 0.5) * 24;
    const top = h * (0.45 + hash2(b, 3, 92) * 0.55);
    const shadeV = 0.6 + hash2(b, 4, 92) * 0.4;
    for (let y = 0; y < top; y++) {
      const t = y / top;
      const x = x0 + lean * t * t;
      const half = 1.6 * (1 - t) + 0.3;
      for (let xx = Math.floor(x - half); xx <= Math.ceil(x + half); xx++) {
        if (xx < 0 || xx >= w) continue;
        const i = (y * w + xx) * 4;
        const v = shadeV * (0.55 + 0.45 * t);
        data[i] = Math.round(255 * v * 0.85);
        data[i + 1] = Math.round(255 * v);
        data[i + 2] = Math.round(255 * v * 0.55);
        data[i + 3] = 255;
      }
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** 草の株: 十字に組んだ板（表と裏で 4 枚）。光は地面と同じく上から当たったように見せる（法線を上へ向ける） */
function grassTuft(): THREE.BufferGeometry {
  // 裏から見たとき法線が下を向いて暗くならないよう、両面を描く代わりに表と裏の板を重ねる
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const g = mergeGeometries([0, 1, 2, 3].map((k) => a.clone().rotateY((k * Math.PI) / 2)));
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/** 道ばたの下草（草の株と低い茂み） */
export function buildUndergrowth(items: readonly Undergrowth[], baseY: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const grass = items.filter((u) => u.kind === 'grass');
  const shrubs = items.filter((u) => u.kind === 'shrub');
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  if (grass.length) {
    const mat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.5, roughness: 1, envMapIntensity: 0.2 });
    const mesh = new THREE.InstancedMesh(grassTuft(), mat, grass.length);
    grass.forEach((u, i) => {
      q.setFromAxisAngle(up, u.yaw);
      mesh.setMatrixAt(i, m.compose(pos.set(u.x, baseY(u.x, u.z) - 0.05, u.z), q, scale.set(u.size * 1.4, u.size, u.size * 1.4)));
      mesh.setColorAt(i, color.setRGB(0.62 + u.tone * 0.25, 0.72 + u.tone * 0.2, 0.5 + u.tone * 0.15));
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  if (shrubs.length) {
    const geo = shade(jitter(new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.6, 1).translate(0, 0.2, 0), 0.08, 93), -0.1, 0.5, 0.5);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.2 });
    const mesh = new THREE.InstancedMesh(geo, mat, shrubs.length);
    shrubs.forEach((u, i) => {
      q.setFromAxisAngle(up, u.yaw);
      mesh.setMatrixAt(i, m.compose(pos.set(u.x, baseY(u.x, u.z) - 0.1, u.z), q, scale.setScalar(u.size)));
      mesh.setColorAt(i, color.setHex(0x3f6e2f).multiplyScalar(0.8 + u.tone * 0.4));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
