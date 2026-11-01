import { describe, expect, it } from 'vitest';
import { IROHA_DOWN_MAP } from './maps';
import { buildRoad } from './road';
import { findRoadShortcuts, roadShortcutHeight } from './roadShortcuts';
import { insideShortcut, shortcutPoint, shortcutStep } from './shortcuts';

describe('road shortcuts', () => {
  const road = buildRoad(IROHA_DOWN_MAP.road!);
  const shortcuts = findRoadShortcuts(road);

  it('finds the inside of every hairpin', () => {
    expect(shortcuts.length).toBe(17);
    for (const sc of shortcuts) {
      // 帯の奥（円弧の中心のさらに内側）は、行きと帰りの道路の間で、どちらの道路の上でもない
      const p = shortcutPoint(sc, 0, sc.wMax - 1);
      for (let i = 0; i < road.count; i++) {
        expect(Math.hypot(p.x - road.x[i], p.z - road.z[i])).toBeGreaterThan(road.width[i] / 2);
      }
    }
  });

  it('descends from the upper road and ends a step above the lower road', () => {
    for (const sc of shortcuts) {
      const w = sc.radius + 6;
      // 下りなので、行き（u < 0）が上の道路
      const upper = shortcutPoint(sc, -sc.uEdge - 0.5, w);
      const nearUpper = shortcutPoint(sc, -sc.uEdge + 0.5, w);
      const nearLower = shortcutPoint(sc, sc.uEdge - 0.5, w);
      const lower = shortcutPoint(sc, sc.uEdge + 0.5, w);
      expect(roadShortcutHeight(road, shortcuts, upper.x, upper.z)).toBeNull();
      expect(roadShortcutHeight(road, shortcuts, lower.x, lower.z)).toBeNull();
      const high = road.heightAt(sc.sIn - (w - sc.radius));
      const low = road.heightAt(sc.sOut + (w - sc.radius));
      expect(high).toBeGreaterThan(low);
      // 上の道路からはなめらかに入れる
      expect(roadShortcutHeight(road, shortcuts, nearUpper.x, nearUpper.z)!).toBeCloseTo(high, 0);
      // 下の道路の縁は段差
      const end = roadShortcutHeight(road, shortcuts, nearLower.x, nearLower.z)!;
      expect(end - low).toBeGreaterThan(0.5 * shortcutStep(high - low));
      expect(end).toBeLessThan(high);
      // 帯の上では、上の道路から下の道路へ向かって下り続ける（上の道路の縁のなめらかなつなぎで数 mm 揺れるのは許す）
      let prev = Infinity;
      for (let u = -sc.uEdge + 0.5; u <= sc.uEdge - 0.5; u += 1) {
        const p = shortcutPoint(sc, u, w);
        const h = roadShortcutHeight(road, shortcuts, p.x, p.z)!;
        expect(h).toBeLessThanOrEqual(prev + 1e-2);
        prev = h;
      }
    }
  });

  it('is outside the band elsewhere', () => {
    const i = road.indexAt(30);
    expect(shortcuts.some((sc) => insideShortcut(sc, road.x[i], road.z[i]))).toBe(false);
    expect(roadShortcutHeight(road, shortcuts, road.x[i] + 30, road.z[i] + 30)).toBeNull();
  });
});
