import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CAR_DIMENSIONS } from '../sim/car';

/**
 * 車体（窓より下）の形。横から見た輪郭（鼻先・ボンネット・トランク・タイヤハウスの丸いえぐり）を、
 * 角を丸めて車幅に押し出し、上側と前後の端を少しすぼめて、箱ではない丸みのあるボディにする
 */

/** ボディの下端の高さ [m] */
export const BODY_BOTTOM = CAR_DIMENSIONS.wheelRadius - 0.075;
/** ボディ上面（窓の下の線）の高さ [m] */
export const BELT_Y = CAR_DIMENSIONS.wheelRadius + 0.475;
/** タイヤハウスの丸いえぐりの半径 [m]（中心はタイヤの軸。ハンドルを切った前輪が収まる大きさ） */
export const ARCH_RADIUS = 0.42;
/** 角を丸める幅: 横から見た角（前後・上下）と、押し出した側面の縁 [m] */
const CORNER = 0.12;
const EDGE_ROUND = 0.07;
/**
 * 側面の縁の丸みが、横から見た輪郭の内側へ入り込む幅 [m]。タイヤハウスの上の細い所（窓の下の線との間）より
 * 狭くして、輪郭が裏返らないようにする
 */
const BEVEL_INSET = 0.025;
/** 上側のすぼまり（窓の下の線で、車幅のこの割合だけ内側に入る）と、前後の端のすぼまり */
const SHOULDER_TAPER = 0.03;
const SHOULDER_HEIGHT = 0.25;
const END_TAPER = 0.07;
const END_LENGTH = 0.6;

export interface BodyShape {
  /** 窓の下の線の前端（フロントガラスの下）と後端（リアガラスの下）の前後位置 [m] */
  frontLow: number;
  rearLow: number;
  /** 鼻先・お尻が、窓の下の線からどれだけ下がるか [m] */
  nose: number;
  tail: number;
}

/** ボディの前後の端の位置（丸めた角を除いた、上面の端） */
const FRONT_TOP = CAR_DIMENSIONS.length / 2 - 0.15;
const REAR_TOP = -CAR_DIMENSIONS.length / 2 + 0.12;

/** 前後位置 z でのボディ上面の高さ（ボンネット・屋根の下・トランク） */
export function bodyTop(shape: BodyShape, z: number): number {
  const curve = (t: number) => Math.pow(Math.min(1, Math.max(0, t)), 1.6);
  if (z > shape.frontLow) return BELT_Y - shape.nose * curve((z - shape.frontLow) / (FRONT_TOP - shape.frontLow));
  if (z < shape.rearLow) return BELT_Y - shape.tail * curve((shape.rearLow - z) / (shape.rearLow - REAR_TOP));
  return BELT_Y;
}

/** 鼻先とお尻の、前と後ろの面の上端の高さ（ライトはこの少し下に付ける） */
export function faceTop(shape: BodyShape, front: boolean): number {
  return bodyTop(shape, front ? FRONT_TOP : REAR_TOP) - 0.1;
}

/** 2 次ベジェ曲線の点（始点を除く） */
function bezier(p0: [number, number], c: [number, number], p1: [number, number], steps = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const d = t * t;
    out.push([a * p0[0] + b * c[0] + d * p1[0], a * p0[1] + b * c[1] + d * p1[1]]);
  }
  return out;
}

/** 横から見た輪郭（[前後 z, 高さ y] の点の並び。前上から後ろへ上面をたどり、下面を前へ戻る） */
export function bodyOutline(shape: BodyShape, arches = true): [number, number][] {
  const { length, wheelRadius, frontAxle, rearAxle } = CAR_DIMENSIONS;
  const front = length / 2;
  const rear = -length / 2;
  const pts: [number, number][] = [];
  // 上面: 前から後ろへ
  const zs = new Set<number>([shape.frontLow, shape.rearLow]);
  for (let z = FRONT_TOP; z > REAR_TOP; z -= 0.1) zs.add(z);
  zs.add(REAR_TOP);
  for (const z of [...zs].filter((z) => z <= FRONT_TOP && z >= REAR_TOP).sort((a, b) => b - a)) pts.push([z, bodyTop(shape, z)]);
  // お尻の角を丸めて、後ろの面を下へ
  const rearTop = bodyTop(shape, REAR_TOP);
  pts.push(...bezier([REAR_TOP, rearTop], [rear, rearTop], [rear, rearTop - CORNER]));
  pts.push([rear, BODY_BOTTOM + CORNER * 0.8]);
  pts.push(...bezier([rear, BODY_BOTTOM + CORNER * 0.8], [rear, BODY_BOTTOM], [rear + CORNER, BODY_BOTTOM], 4));
  // 下面: 後ろから前へ。タイヤの上を丸くえぐる
  const beta = Math.asin((wheelRadius - BODY_BOTTOM) / ARCH_RADIUS);
  for (const axle of arches ? [rearAxle, frontAxle] : []) {
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const th = Math.PI + beta - (i / steps) * (Math.PI + 2 * beta);
      pts.push([axle + ARCH_RADIUS * Math.cos(th), wheelRadius + ARCH_RADIUS * Math.sin(th)]);
    }
  }
  pts.push([front - CORNER, BODY_BOTTOM]);
  pts.push(...bezier([front - CORNER, BODY_BOTTOM], [front, BODY_BOTTOM], [front, BODY_BOTTOM + CORNER * 0.8], 4));
  // 前の面を上へ。鼻先の角を丸めてボンネットへつなぐ
  const frontTop = bodyTop(shape, FRONT_TOP);
  pts.push([front, frontTop - CORNER]);
  const nose = bezier([front, frontTop - CORNER], [front, frontTop], [FRONT_TOP, frontTop]);
  nose.pop(); // 最初の点と同じ
  pts.push(...nose);
  // 近すぎる点（窓の下の端と、等間隔の点が重なったところ）を除く
  return pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.01);
}

/** その位置で、車幅をどれだけすぼめるか（1 = すぼめない） */
export function bodyTaper(y: number, z: number): number {
  const up = Math.max(0, Math.min(1, (y - (BELT_Y - SHOULDER_HEIGHT)) / SHOULDER_HEIGHT));
  const end = Math.max(0, Math.min(1, (Math.abs(z) - (CAR_DIMENSIONS.length / 2 - END_LENGTH)) / END_LENGTH));
  return (1 - SHOULDER_TAPER * up * up) * (1 - END_TAPER * end * end);
}

/** 窓の下の線での、ボディの上面の半分の幅（窓や屋根はこれより内側に置く） */
export const SHOULDER_HALF = (CAR_DIMENSIONS.width / 2) * (1 - SHOULDER_TAPER) - EDGE_ROUND;

/**
 * ボディの中の、左右のタイヤの間を埋める暗い芯（タイヤハウスをえぐった所から、奥が抜けて見えないように）。
 * えぐりのない輪郭を、ボディの表面より少し内側に収めて halfWidth の幅に押し出す
 */
export function coreGeometry(shape: BodyShape, halfWidth: number): THREE.BufferGeometry {
  const s = new THREE.Shape(bodyOutline(shape, false).map(([z, y]) => new THREE.Vector2(z * 0.99, y < BODY_BOTTOM + 0.05 ? y + 0.01 : y - 0.02)));
  return new THREE.ExtrudeGeometry(s, { depth: halfWidth * 2, bevelEnabled: false }).translate(0, 0, -halfWidth).rotateY(-Math.PI / 2);
}

/** 丸みのあるボディの形（車体ローカル。前方 +Z・上 +Y） */
export function bodyGeometry(shape: BodyShape): THREE.BufferGeometry {
  const outline = bodyOutline(shape);
  const s = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)));
  const depth = CAR_DIMENSIONS.width - 2 * EDGE_ROUND;
  const geo = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: EDGE_ROUND,
    bevelSize: BEVEL_INSET,
    bevelOffset: -BEVEL_INSET,
    bevelSegments: 4,
    curveSegments: 4,
  });
  geo.translate(0, 0, -depth / 2);
  // 押し出した向き（Z）を車幅（X）に、輪郭の横（X）を前後（Z）にする
  geo.rotateY(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * bodyTaper(pos.getY(i), pos.getZ(i)));
  geo.deleteAttribute('normal');
  const smooth = toCreasedNormals(geo, 0.5);
  geo.dispose();
  // 側面の大きな平らな面は、細長い三角形に分かれている。頂点の向きを三角形どうしで平均すると斜めの縞が出るので、
  // すぼめた面の向き（x = 幅 × すぼまり の傾き）をそのまま使う
  const p = smooth.getAttribute('position');
  const n = smooth.getAttribute('normal');
  const face = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const d = 0.01;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    face.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    if (Math.abs(face.x) < 0.9) continue;
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k);
      const y = p.getY(i + k);
      const z = p.getZ(i + k);
      const half = x / bodyTaper(y, z);
      const dy = (half * (bodyTaper(y + d, z) - bodyTaper(y - d, z))) / (2 * d);
      const dz = (half * (bodyTaper(y, z + d) - bodyTaper(y, z - d))) / (2 * d);
      a.set(Math.sign(x), -dy, -dz).normalize();
      n.setXYZ(i + k, a.x, a.y, a.z);
    }
  }
  return smooth;
}
