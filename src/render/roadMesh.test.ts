import { describe, expect, it } from 'vitest';
import { asphaltPatch, roadSamples } from './roadMesh';

describe('路面の色のムラ', () => {
  it('断面の点は端から端まで並び、タイヤの通る所は暗く、端は明るい', () => {
    const s = roadSamples(8, 2);
    expect(s[0][0]).toBe(-4);
    expect(s[s.length - 1][0]).toBe(4);
    for (let i = 1; i < s.length; i++) expect(s[i][0]).toBeGreaterThan(s[i - 1][0]);
    const at = (u: number) => s.find(([x]) => Math.abs(x - u) < 1e-6)![1];
    // 左の車線の中心は -2、タイヤは ±0.75
    expect(at(-2.75)).toBeLessThan(at(-2));
    expect(at(-1.25)).toBeLessThan(at(-2));
    expect(at(-4)).toBeGreaterThan(at(-2));
    expect(at(0)).toBe(1);
  });

  it('細い 1 車線ずつの道（首都高の狭い車線など）でも点が重ならない', () => {
    const s = roadSamples(6, 3);
    expect(new Set(s.map(([u]) => u.toFixed(6))).size).toBe(s.length);
  });

  it('ムラと補修跡の明るさは 0.6〜1.1 に収まり、古い道のほうが補修跡が多い', () => {
    let darkOld = 0;
    let darkNew = 0;
    for (let s = 0; s < 3000; s += 1) {
      for (const u of [-2, 2]) {
        const o = asphaltPatch(s, u, 8, true);
        const n = asphaltPatch(s, u, 8, false);
        for (const v of [o, n]) {
          expect(v).toBeGreaterThan(0.6);
          expect(v).toBeLessThan(1.1);
        }
        if (o < 0.8) darkOld++;
        if (n < 0.85) darkNew++;
      }
    }
    expect(darkOld).toBeGreaterThan(darkNew);
    expect(darkNew).toBeGreaterThan(0);
  });
});
