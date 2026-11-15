import { describe, expect, it } from 'vitest';
import { RANGES, ridgeHeight } from './farMountains';

describe('遠くの山並み', () => {
  for (const range of RANGES) {
    it(`半径 ${range.radius}m の山: 高さは範囲内で、一周してつながり、高い所と低い所がある`, () => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < 720; k++) {
        const h = ridgeHeight((k / 720) * Math.PI * 2, range);
        expect(h).toBeGreaterThanOrEqual(range.min - 1e-9);
        expect(h).toBeLessThanOrEqual(range.max + 1e-9);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      expect(hi - lo).toBeGreaterThan((range.max - range.min) * 0.3);
      expect(ridgeHeight(0, range)).toBeCloseTo(ridgeHeight(Math.PI * 2, range), 6);
    });
  }
});
