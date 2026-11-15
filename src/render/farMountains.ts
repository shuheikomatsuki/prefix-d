import * as THREE from 'three';
import { noise2 } from './courseTextures';

/**
 * 遠くの山並み（背景）。カメラを囲む 2 重の輪で、近い輪は濃く低く、遠い輪は空の色に近く高い。
 * カメラと一緒に動かす（とても遠いので、動かしても見え方は変わらない）。霧の影響は受けず、色は時間帯・天気に
 * 合わせて空の色（地平線の色）へ寄せる（遠い物ほど空気でかすむ）。根元は地平線の色にして、霧でかすんだ地面とつなぐ
 */

/** 山の輪の半径 [m] と、高さの範囲 [m]（カメラの高さから） */
const RANGES = [
  { radius: 1350, min: 70, max: 260, seed: 121, haze: 0.55 },
  { radius: 1050, min: 30, max: 150, seed: 122, haze: 0.3 },
] as const;
/** 輪を分ける数 */
const SEGMENTS = 256;
/** 山の根元の、カメラからの深さ [m] */
const BASE = -260;

/** 向き a [rad] での、山の高さ [m]（いくつかの細かさのノイズを重ね、ところどころ高い峰にする） */
export function ridgeHeight(a: number, range: (typeof RANGES)[number]): number {
  // 一周でつながるよう、円の上の点でノイズを取る
  const x = Math.cos(a);
  const z = Math.sin(a);
  let n = 0;
  let amp = 1;
  let f = 2.5;
  let sum = 0;
  for (let o = 0; o < 5; o++) {
    n += noise2(x * f + 10, z * f + 10, range.seed + o) * amp;
    sum += amp;
    amp *= 0.5;
    f *= 2.1;
  }
  n /= sum;
  // 尾根を尖らせる
  const peak = Math.pow(n, 1.6);
  return range.min + (range.max - range.min) * peak;
}

export class FarMountains {
  readonly group = new THREE.Group();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private readonly ranges: { mesh: THREE.Mesh; haze: number; tops: Float32Array }[] = [];

  constructor() {
    for (const range of RANGES) {
      const positions: number[] = [];
      const tops: number[] = [];
      for (let k = 0; k <= SEGMENTS; k++) {
        const a = (k / SEGMENTS) * Math.PI * 2;
        const h = ridgeHeight(a % (Math.PI * 2), range);
        const x = Math.cos(a) * range.radius;
        const z = Math.sin(a) * range.radius;
        positions.push(x, BASE, z, x, h, z);
        tops.push(0, 1);
      }
      const index: number[] = [];
      for (let k = 0; k < SEGMENTS; k++) {
        const b = k * 2;
        // 内側（カメラのほう）を向く面
        index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
      g.setIndex(index);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      // 空の次、ほかの物より先に描く（手前の物が上に重なる）
      mesh.renderOrder = -10 + this.ranges.length;
      this.group.add(mesh);
      this.ranges.push({ mesh, haze: range.haze, tops: new Float32Array(tops) });
    }
  }

  /**
   * 色を合わせる。horizon は地平線の空の色、body は晴れた日の近くの山の色。haze が大きいほど空の色に近づく
   * （雨や霧の日は大きく）
   */
  setColors(horizon: THREE.Color, body: THREE.Color, haze: number): void {
    const c = new THREE.Color();
    for (const r of this.ranges) {
      const colors = r.mesh.geometry.attributes.color as THREE.BufferAttribute;
      const top = c.copy(body).lerp(horizon, Math.min(1, r.haze + haze * (1 - r.haze)));
      for (let i = 0; i < r.tops.length; i++) {
        // 根元は地平線の色、上ほど山の色
        const v = r.tops[i];
        const col = horizon.clone().lerp(top, v);
        colors.setXYZ(i, col.r, col.g, col.b);
      }
      colors.needsUpdate = true;
    }
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** カメラに合わせて動かす */
  follow(camera: THREE.Camera): void {
    this.group.position.set(camera.position.x, camera.position.y, camera.position.z);
  }
}
