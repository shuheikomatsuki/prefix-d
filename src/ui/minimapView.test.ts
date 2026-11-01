import { describe, expect, it } from 'vitest';
import { localTransform } from './minimapView';

describe('localTransform', () => {
  it('進行方向が上: どの向きでも前方が地図の上、右手が地図の右に来る', () => {
    for (const yaw of [0, 0.7, 2, -2.5, Math.PI]) {
      const t = localTransform('heading', 100, -50, yaw, 200);
      const [cx, cy] = t.toMap(100, -50);
      const [fx, fy] = t.toMap(100 + Math.sin(yaw) * 50, -50 + Math.cos(yaw) * 50);
      expect(fx - cx).toBeCloseTo(0, 6);
      expect(fy - cy).toBeLessThan(0);
      // 回しても左右が入れ替わらない: 前方と右手の向きの外積の符号が、北が上の地図と同じ
      const n = localTransform('north', 100, -50, yaw, 200);
      const right = { x: 100 - Math.cos(yaw) * 50, z: -50 + Math.sin(yaw) * 50 };
      const [nfx, nfy] = n.toMap(100 + Math.sin(yaw) * 50, -50 + Math.cos(yaw) * 50);
      const [nrx, nry] = n.toMap(right.x, right.z);
      const [rx, ry] = t.toMap(right.x, right.z);
      const sideN = (nfx - 100) * (nry - 100) - (nfy - 100) * (nrx - 100);
      const sideH = (fx - cx) * (ry - cy) - (fy - cy) * (rx - cx);
      expect(Math.sign(sideH)).toBe(Math.sign(sideN));
    }
  });

  it('北が上: 自分が真ん中で、回さない', () => {
    const t = localTransform('north', 30, 40, 1.2, 200);
    expect(t.toMap(30, 40)).toEqual([100, 100]);
    const [x, y] = t.toMap(30, 40 - 100);
    expect(x).toBeCloseTo(100, 6);
    expect(y).toBeLessThan(100);
  });

  it('matrix は toMap と同じ変換', () => {
    const t = localTransform('heading', 12, -7, 0.9, 180);
    const [a, b, c, d, e, f] = t.matrix;
    const p = { x: 60, z: 25 };
    const [mx, my] = t.toMap(p.x, p.z);
    expect(a * p.x + c * p.z + e).toBeCloseTo(mx, 6);
    expect(b * p.x + d * p.z + f).toBeCloseTo(my, 6);
  });
});
