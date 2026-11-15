import { describe, expect, it } from 'vitest';
import { asphaltImages, concreteImages, fbm, groundImages, hash2, noise2, normalMap, paintImages, rockImages } from './courseTextures';

describe('コースの質感の画像', () => {
  it('ノイズは 0〜1 で、同じ入力なら同じ値', () => {
    const a = fbm(32, 4, 3, 1);
    const b = fbm(32, 4, 3, 1);
    expect(a).toEqual(b);
    expect(Math.min(...a)).toBeCloseTo(0);
    expect(Math.max(...a)).toBeCloseTo(1);
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    for (let i = 0; i < 50; i++) {
      const v = noise2(i * 0.37, i * 0.71, 2);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('ノイズの画像は端どうしがつながる（くり返して貼っても継ぎ目が出ない）', () => {
    const size = 64;
    const n = fbm(size, 4, 4, 7);
    // 右端と左端、下端と上端の差は、となりの画素どうしの差と同じくらい小さい
    let edge = 0;
    let inner = 0;
    for (let y = 0; y < size; y++) {
      edge += Math.abs(n[y * size + size - 1] - n[y * size]);
      inner += Math.abs(n[y * size + 1] - n[y * size]);
    }
    for (let x = 0; x < size; x++) edge += Math.abs(n[(size - 1) * size + x] - n[x]);
    expect(edge / (2 * size)).toBeLessThan((inner / size) * 3 + 0.02);
  });

  it('平らな高さの法線は真上を向き、傾いた高さでは傾く', () => {
    const size = 8;
    const flat = normalMap(new Float32Array(size * size).fill(0.5), size, 2);
    expect([flat[0], flat[1], flat[2]]).toEqual([128, 128, 255]);
    const ramp = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) ramp[y * size + x] = x * 0.1;
    const n = normalMap(ramp, size, 2);
    // x が増えるほど高い → 法線は -x へ傾く
    const i = (3 * size + 3) * 4;
    expect(n[i]).toBeLessThan(128);
    expect(n[i + 1]).toBe(128);
  });

  it('どの質感も、色・粗さ・法線の画像がそろい、明るさの平均がほどほど', () => {
    for (const img of [asphaltImages(64), groundImages(64), rockImages(64), concreteImages(64), paintImages(64)]) {
      expect(img.color.length).toBe(img.size * img.size * 4);
      expect(img.roughness.length).toBe(img.color.length);
      expect(img.normal.length).toBe(img.color.length);
      expect(img.mean).toBeGreaterThan(0.15);
      expect(img.mean).toBeLessThan(0.95);
    }
  });
});
