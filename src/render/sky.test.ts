import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultQuality } from './quality';
import { SKY_HEIGHT, SKY_WIDTH, STAR_COUNT, createStars, skyDirection, skyImage } from './sky';

const at = (img: Uint8Array, x: number, y: number) => {
  const i = (y * SKY_WIDTH + x) * 4;
  return [img[i], img[i + 1], img[i + 2]];
};

describe('空の背景', () => {
  it('画像の上の端は真上、真ん中の段は地平線を向く', () => {
    expect(skyDirection(0, SKY_HEIGHT - 1).y).toBeGreaterThan(0.99);
    expect(Math.abs(skyDirection(10, SKY_HEIGHT / 2).y)).toBeLessThan(0.02);
    expect(skyDirection(10, 0).y).toBeLessThan(-0.99);
  });

  it('地平線は霧の色、真上は濃い色、太陽の方向は明るい', () => {
    const sun = new THREE.Vector3(-30, 60, -20);
    const img = skyImage({ zenith: 0x4a86d4, horizon: 0xa9d4f5, sun, glow: 0xffffff, glowStrength: 1 });
    const horizon = at(img, 0, SKY_HEIGHT / 2);
    expect(horizon[0]).toBeGreaterThan(0xa9 - 6);
    expect(horizon[0]).toBeLessThan(0xa9 + 6);
    const top = at(img, 0, SKY_HEIGHT - 1);
    expect(top[0]).toBeLessThan(0x4a + 12);
    // 太陽の方向に一番近い点
    let best = -2;
    let bx = 0;
    let by = 0;
    const d = new THREE.Vector3();
    const n = sun.clone().normalize();
    for (let y = 0; y < SKY_HEIGHT; y += 2) {
      for (let x = 0; x < SKY_WIDTH; x += 2) {
        const c = skyDirection(x, y, d).dot(n);
        if (c > best) {
          best = c;
          bx = x;
          by = y;
        }
      }
    }
    const s = at(img, bx, by);
    expect(s[0] + s[1] + s[2]).toBeGreaterThan(700);
  });

  it('星は空の上半分に散らばる', () => {
    const stars = createStars();
    const p = stars.geometry.attributes.position;
    expect(p.count).toBe(STAR_COUNT);
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeGreaterThan(0);
  });
});

describe('画質', () => {
  it('はじめはパソコンなら高、スマホなら標準', () => {
    expect(defaultQuality(false)).toBe('high');
    expect(defaultQuality(true)).toBe('standard');
  });
});

describe('雲', () => {
  it('雲を出すと空の上のほうに白い所が増える', () => {
    const base = { zenith: 0x4a86d4, horizon: 0xa9d4f5, sun: new THREE.Vector3(0, -1, 0), glow: 0xffffff, glowStrength: 0 };
    const white = (img: Uint8Array) => {
      let n = 0;
      for (let y = SKY_HEIGHT * 0.6; y < SKY_HEIGHT; y++) {
        for (let x = 0; x < SKY_WIDTH; x += 4) {
          const [r, g, b] = at(img, x, Math.floor(y));
          if (r > 200 && g > 200 && b > 200) n++;
        }
      }
      return n;
    };
    expect(white(skyImage(base))).toBe(0);
    expect(white(skyImage({ ...base, clouds: 0.55 }))).toBeGreaterThan(100);
  });
});
