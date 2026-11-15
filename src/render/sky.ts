import * as THREE from 'three';
import { hash2, noise2 } from './courseTextures';

/**
 * 空の背景（scene.background）。真上は濃い色、地平線は霧と同じ色のグラデーションに、太陽（夜は月）の
 * まわりの明るいにじみを足した画像を、全方向を覆う背景（正距円筒図法）にする。夜の星は小さな点（createStars）。
 * 地平線の色を霧の色とそろえるので、遠くの山は空に溶け込む
 */

export interface SkyParams {
  /** 真上の色 */
  zenith: number;
  /** 地平線の色（霧の色と同じ） */
  horizon: number;
  /** 太陽（月）の向き（向かう先ではなく、太陽のある方向） */
  sun: THREE.Vector3;
  /** 太陽のにじみの色と強さ（0 = なし） */
  glow: number;
  glowStrength: number;
  /** 雲の量（0 = 雲なし、1 = 空の半分くらい）と色 */
  clouds?: number;
  cloudColor?: number;
}

export const SKY_WIDTH = 512;
export const SKY_HEIGHT = 256;

/** 画像の点 (x, y) が向く方向（three.js の正距円筒図法の背景と同じ向き。y = 0 が真下） */
export function skyDirection(x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
  const u = (x + 0.5) / SKY_WIDTH;
  const v = (y + 0.5) / SKY_HEIGHT;
  const lon = (u - 0.5) * 2 * Math.PI;
  const lat = (v - 0.5) * Math.PI;
  // three.js の equirectUv: u = atan(dir.z, dir.x) / 2π + 0.5、v = asin(dir.y) / π + 0.5
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
}

/** 空の画像（RGBA、sRGB） */
export function skyImage(p: SkyParams): Uint8Array {
  const data = new Uint8Array(SKY_WIDTH * SKY_HEIGHT * 4);
  const zenith = new THREE.Color(p.zenith);
  const horizon = new THREE.Color(p.horizon);
  const glow = new THREE.Color(p.glow);
  const sun = p.sun.clone().normalize();
  const cloud = new THREE.Color(p.cloudColor ?? 0xffffff);
  const d = new THREE.Vector3();
  const c = new THREE.Color();
  for (let y = 0; y < SKY_HEIGHT; y++) {
    for (let x = 0; x < SKY_WIDTH; x++) {
      skyDirection(x, y, d);
      const up = d.y;
      // 地平線の近くは広く地平線の色、上へ行くほど真上の色。地平線より下は地平線の色のまま
      c.copy(horizon).lerp(zenith, Math.pow(Math.max(0, up), 0.55));
      if (p.glowStrength > 0) {
        const cos = d.dot(sun);
        // 太陽の円盤（とても明るい）と、まわりの広いにじみ
        const halo = Math.pow(Math.max(0, cos), 24) * 0.55 + Math.pow(Math.max(0, cos), 400) * 0.6 + (cos > 0.9993 ? 1 : 0);
        c.lerp(glow, Math.min(1, halo * p.glowStrength));
      }
      if (p.clouds && up > 0.02) {
        // 空を高さ一定の平らな面とみなし、その面の上の位置でノイズを取る（地平線へ行くほど雲が小さく、つぶれる）
        const px = (d.x / up) * 0.6;
        const pz = (d.z / up) * 0.6;
        let n = 0;
        let amp = 0.55;
        let f = 1;
        for (let o = 0; o < 4; o++) {
          n += noise2(px * f + 3, pz * f + 7, 131 + o) * amp;
          amp *= 0.5;
          f *= 2.3;
        }
        // n の平均は 0.5 くらい。量が多いほど、低いノイズでも雲にする
        const t = Math.max(0, Math.min(1, (n / 1.03 - (0.75 - p.clouds * 0.4)) / 0.12));
        // 地平線の近くは薄く（遠くの雲はかすむ）
        c.lerp(cloud, t * 0.85 * Math.min(1, up * 6));
      }
      const i = (y * SKY_WIDTH + x) * 4;
      // Color の値はリニアなので、画像（sRGB）に戻して入れる
      const s = c.clone().convertLinearToSRGB();
      data[i] = Math.round(Math.min(1, s.r) * 255);
      data[i + 1] = Math.round(Math.min(1, s.g) * 255);
      data[i + 2] = Math.round(Math.min(1, s.b) * 255);
      data[i + 3] = 255;
    }
  }
  return data;
}

/** 空の画像を背景のテクスチャにする */
export function skyTexture(p: SkyParams): THREE.DataTexture {
  const t = new THREE.DataTexture(skyImage(p), SKY_WIDTH, SKY_HEIGHT, THREE.RGBAFormat);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 星の数 */
export const STAR_COUNT = 1400;

/**
 * 夜の星: 空の上半分に散らばる小さな点（画面の上で 1〜2 画素。背景の画像に描くと粗くて四角く見えるので、点で描く）。
 * カメラと一緒に動かす。霧の影響は受けない
 */
export function createStars(): THREE.Points {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // 上半分に一様に（高さ 0.08 より上）
    const y = 0.08 + hash2(i, 1, 112) * 0.92;
    const a = hash2(i, 2, 112) * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    const R = 1200;
    positions.set([Math.cos(a) * r * R, y * R, Math.sin(a) * r * R], i * 3);
    const b = 0.35 + Math.pow(hash2(i, 3, 112), 3) * 0.65;
    const warm = hash2(i, 4, 112) * 0.15;
    colors.set([b, b * (1 - warm * 0.3), b * (1 - warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, depthWrite: false }));
  stars.frustumCulled = false;
  stars.renderOrder = -20;
  return stars;
}
