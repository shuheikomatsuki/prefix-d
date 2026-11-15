import * as THREE from 'three';

/**
 * コースの質感の画像（アスファルト・地面・岩・コンクリート・白線のかすれ）を、乱数のノイズから作る。
 * 外部の画像ファイルを使わず、端どうしがつながる（くり返して貼っても継ぎ目が出ない）画像にする。
 * 画像の値はここで配列として作り、three.js のテクスチャにするのは最後だけ（単体テストで中身を確かめられる）
 */

/** 整数の座標から 0〜1 の乱数を作る（同じ入力なら同じ値） */
export function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * 周期 period（格子の数）でくり返す値ノイズ。x, y は格子の単位
 */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const v = (i: number, j: number) => hash2(wrap(i, period), wrap(j, period), seed);
  const a = v(x0, y0);
  const b = v(x0 + 1, y0);
  const c = v(x0, y0 + 1);
  const d = v(x0 + 1, y0 + 1);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * size × size の画像全体で端がつながる、細かさの違うノイズを重ねたもの（0〜1）。
 * cells は一番粗いノイズの、画像 1 枚あたりの格子の数。ridged にすると尾根のような筋（岩の割れ目）になる
 */
export function fbm(size: number, cells: number, octaves: number, seed: number, options: { gain?: number; ridged?: boolean; stretch?: number } = {}): Float32Array {
  const { gain = 0.5, ridged = false, stretch = 1 } = options;
  const out = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      let amp = 1;
      let c = cells;
      for (let o = 0; o < octaves; o++) {
        // stretch は縦（y）の格子を粗くして、横に長い筋（地層）にする
        const cy = Math.max(1, Math.round(c / stretch));
        let n = valueNoise((x / size) * c, (y / size) * cy, c, seed + o * 101 + (cy === c ? 0 : 7));
        if (ridged) n = 1 - Math.abs(2 * n - 1);
        sum += n * amp;
        amp *= gain;
        c *= 2;
      }
      out[y * size + x] = sum;
      min = Math.min(min, sum);
      max = Math.max(max, sum);
    }
  }
  const range = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / range;
  return out;
}

/** 高さの画像から、凹凸の向き（法線マップ。RGB に x, y, z を 0〜255 で入れる）を作る */
export function normalMap(height: Float32Array, size: number, strength: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const h = (x: number, y: number) => height[wrap(y, size) * size + wrap(x, size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      // 画像の上（v が増える向き）を +y にする
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      out[i + 1] = Math.round(((dy / len) * 0.5 + 0.5) * 255);
      out[i + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** 小さな丸（骨材の石・葉）を、端をまたいでもつながるように描き込む */
function stamp(target: Float32Array, size: number, cx: number, cy: number, r: number, value: number, mode: 'add' | 'max' = 'add') {
  const r2 = r * r;
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const i = wrap(Math.round(cy) + dy, size) * size + wrap(Math.round(cx) + dx, size);
      const v = value * (1 - d2 / (r2 + 1));
      target[i] = mode === 'add' ? target[i] + v : Math.max(target[i], v);
    }
  }
}

/** 色・粗さ・凹凸の 3 枚の画像 */
export interface SurfaceImages {
  size: number;
  /** 色（RGBA。sRGB）。頂点の色や材質の色に掛けて使う */
  color: Uint8Array;
  /** 粗さ（G に 0〜255。three.js の roughnessMap は G を読む） */
  roughness: Uint8Array;
  normal: Uint8Array;
  /** 色の明るさの平均（リニア） */
  mean: number;
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

function images(size: number, lum: Float32Array, rough: Float32Array, height: Float32Array, strength: number, tint: (i: number) => [number, number, number] = () => [1, 1, 1]): SurfaceImages {
  const color = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  let sum = 0;
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = tint(i);
    color[i * 4] = byte(lum[i] * r);
    color[i * 4 + 1] = byte(lum[i] * g);
    color[i * 4 + 2] = byte(lum[i] * b);
    color[i * 4 + 3] = 255;
    roughness[i * 4 + 1] = byte(rough[i]);
    roughness[i * 4 + 3] = 255;
    // 材質の色はリニアの値に掛かるので、平均もリニアで求める
    sum += Math.pow(Math.max(0, Math.min(1, lum[i])), 2.2);
  }
  return { size, color, roughness, normal: normalMap(height, size, strength), mean: sum / (size * size) };
}

/** 1 枚の画像が覆う大きさ [m]（UV はメートルをこれで割る） */
export const TEXTURE_METERS = { asphalt: 4, ground: 6, rock: 5, concrete: 3, paint: 3 } as const;

/** アスファルト: 細かい粒、ところどころの骨材の石、大きなムラ、細いひび */
export function asphaltImages(size = 512): SurfaceImages {
  const fine = fbm(size, 128, 2, 11);
  const mid = fbm(size, 8, 4, 12);
  const stones = new Float32Array(size * size);
  const stoneTone = new Float32Array(size * size);
  const count = size * size * 0.012;
  for (let k = 0; k < count; k++) {
    const x = hash2(k, 1, 13) * size;
    const y = hash2(k, 2, 13) * size;
    const r = 0.8 + hash2(k, 3, 13) * 1.8;
    stamp(stones, size, x, y, r, 1, 'max');
    stamp(stoneTone, size, x, y, r, hash2(k, 4, 13) - 0.45, 'add');
  }
  // ひび: 少しずつ向きを変えながら伸ばす線
  const cracks = new Float32Array(size * size);
  for (let c = 0; c < 6; c++) {
    let x = hash2(c, 1, 14) * size;
    let y = hash2(c, 2, 14) * size;
    let a = hash2(c, 3, 14) * Math.PI * 2;
    const len = size * (0.15 + hash2(c, 4, 14) * 0.35);
    for (let s = 0; s < len; s++) {
      a += (hash2(c, s, 15) - 0.5) * 0.5;
      x += Math.cos(a);
      y += Math.sin(a);
      stamp(cracks, size, x, y, 0.9, 1, 'max');
    }
  }
  const n = size * size;
  const lum = new Float32Array(n);
  const rough = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.74 + (mid[i] - 0.5) * 0.14 + (fine[i] - 0.5) * 0.16 + stoneTone[i] * stones[i] * 0.35 - cracks[i] * 0.3;
    rough[i] = 0.9 + (fine[i] - 0.5) * 0.1 - stones[i] * 0.18;
    height[i] = fine[i] * 0.6 + stones[i] * 0.8 - cracks[i] * 1.2;
  }
  return images(size, lum, rough, height, 2.2);
}

/** 地面: 草の株や土のムラ。色は頂点の色（草・岩）に掛けるので、ほぼ灰色で少しだけ黄色や緑に振る */
export function groundImages(size = 256): SurfaceImages {
  const mid = fbm(size, 6, 4, 21);
  const fine = fbm(size, 64, 3, 22);
  const hue = fbm(size, 4, 3, 23);
  const clumps = new Float32Array(size * size);
  const count = size * size * 0.03;
  for (let k = 0; k < count; k++) stamp(clumps, size, hash2(k, 1, 24) * size, hash2(k, 2, 24) * size, 1 + hash2(k, 3, 24) * 2.5, 0.6 + hash2(k, 4, 24) * 0.4, 'max');
  const n = size * size;
  const lum = new Float32Array(n);
  const rough = new Float32Array(n).fill(1);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.72 + (mid[i] - 0.5) * 0.3 + (fine[i] - 0.5) * 0.2 + clumps[i] * 0.14;
    height[i] = fine[i] * 0.5 + clumps[i];
  }
  return images(size, lum, rough, height, 1.4, (i) => {
    const t = (hue[i] - 0.5) * 0.16;
    return [1 + t, 1, 1 - t * 1.5];
  });
}

/** 岩: 割れ目の筋と、横に走る地層 */
export function rockImages(size = 256): SurfaceImages {
  const ridges = fbm(size, 4, 5, 31, { ridged: true, gain: 0.55 });
  const strata = fbm(size, 8, 3, 32, { stretch: 8 });
  const fine = fbm(size, 64, 2, 33);
  const n = size * size;
  const lum = new Float32Array(n);
  const rough = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.6 + (strata[i] - 0.5) * 0.3 + (ridges[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.15;
    rough[i] = 0.85 + (fine[i] - 0.5) * 0.2;
    height[i] = ridges[i] * 1.2 + strata[i] * 0.4 + fine[i] * 0.2;
  }
  return images(size, lum, rough, height, 4);
}

/** コンクリート: 細かいざらつきと、雨だれのような大きなシミ */
export function concreteImages(size = 256): SurfaceImages {
  const fine = fbm(size, 96, 2, 41);
  const stains = fbm(size, 4, 4, 42, { stretch: 0.25 });
  const pits = new Float32Array(size * size);
  for (let k = 0; k < size * size * 0.004; k++) stamp(pits, size, hash2(k, 1, 43) * size, hash2(k, 2, 43) * size, 0.7 + hash2(k, 3, 43), 1, 'max');
  const n = size * size;
  const lum = new Float32Array(n);
  const rough = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.84 + (fine[i] - 0.5) * 0.1 - Math.max(0, stains[i] - 0.45) * 0.4 - pits[i] * 0.07;
    rough[i] = 0.92;
    height[i] = fine[i] * 0.4 - pits[i];
  }
  return images(size, lum, rough, height, 1.5);
}

/** 白線のかすれ: タイヤで削れた所が下のアスファルトの色に近づく */
export function paintImages(size = 128): SurfaceImages {
  const worn = fbm(size, 6, 4, 51);
  const fine = fbm(size, 48, 2, 52);
  const n = size * size;
  const lum = new Float32Array(n);
  const rough = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = Math.max(0, Math.min(1, (worn[i] - 0.55) * 3)) * (0.6 + fine[i] * 0.4);
    lum[i] = 0.95 - w * 0.5 - (fine[i] - 0.5) * 0.06;
    rough[i] = 0.6 + w * 0.3;
    height[i] = fine[i] * 0.3 - w * 0.3;
  }
  return images(size, lum, rough, height, 1);
}

/** 質感の 3 枚のテクスチャ */
export interface SurfaceTextures {
  map: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  /** 色の画像の明るさの平均（材質の色をこれで割ると、元の色の明るさに戻る） */
  mean: number;
}

function texture(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  // 斜めから見る路面がぼやけないように（実際の値は GPU の上限で抑えられる）
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const cache = new Map<string, SurfaceTextures>();

/** 質感のテクスチャ（作るのに少し時間がかかるので、一度作ったものを使い回す） */
export function surfaceTextures(kind: keyof typeof TEXTURE_METERS): SurfaceTextures {
  let t = cache.get(kind);
  if (!t) {
    const img = { asphalt: asphaltImages, ground: groundImages, rock: rockImages, concrete: concreteImages, paint: paintImages }[kind]();
    t = { map: texture(img.color, img.size, true), roughnessMap: texture(img.roughness, img.size, false), normalMap: texture(img.normal, img.size, false), mean: img.mean };
    cache.set(kind, t);
  }
  return t;
}

/** くり返さない、なめらかな値ノイズ（0〜1）。x, y は格子の単位（地面の大きなムラなどに使う） */
export function noise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}
