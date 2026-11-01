import { describe, expect, it } from 'vitest';
import { IROHA_DOWN_MAP, IROHA_UP_MAP } from './maps';
import { FLAG_BLIND, buildRoad } from './road';
import { buildRoadCuts } from './roadCuts';
import { buildRoadObstacles } from './roadObstacles';

describe('road cuts', () => {
  for (const map of [IROHA_DOWN_MAP, IROHA_UP_MAP]) {
    const road = buildRoad(map.road!);
    const cuts = buildRoadCuts(road);

    it(`${map.id}: puts a rock face on the uphill side between hairpins`, () => {
      let blind = 0;
      let cut = 0;
      for (let i = 0; i < road.count; i++) {
        if (!(road.flags[i] & FLAG_BLIND)) {
          // 見通しの悪い区間の外には崖がない
          expect(cuts.left[i] + cuts.right[i]).toBe(0);
          continue;
        }
        blind++;
        if (cuts.left[i] > 1.5 || cuts.right[i] > 1.5) cut++;
        // 崖は片側（上の道路のある側）だけ
        expect(Math.min(cuts.left[i], cuts.right[i])).toBe(0);
      }
      expect(blind).toBeGreaterThan(1500);
      expect(cut / blind).toBeGreaterThan(0.8);
    });

    it(`${map.id}: the rock face stays below the road above it`, () => {
      for (let i = 0; i < road.count; i += 5) {
        for (const [side, a] of [[1, cuts.left], [-1, cuts.right]] as const) {
          // 区間の端で低くなっていく所は除く
          if (a[i] < 4) continue;
          // 崖の上の端は、横を通る上の道路の高さを大きく超えない（道路に沿ってならした分だけ超えることがある）
          const top = road.h[i] + a[i];
          const lx = Math.cos(road.yaw[i]) * side;
          const lz = -Math.sin(road.yaw[i]) * side;
          let above = -Infinity;
          for (let k = 0; k < road.count; k++) {
            if (Math.abs(k - i) < 60) continue;
            const along = (road.x[k] - road.x[i]) * Math.sin(road.yaw[i]) + (road.z[k] - road.z[i]) * Math.cos(road.yaw[i]);
            const lateral = (road.x[k] - road.x[i]) * lx + (road.z[k] - road.z[i]) * lz;
            if (Math.abs(along) < 20 && lateral > 0 && lateral < 55) above = Math.max(above, road.h[k]);
          }
          expect(top).toBeLessThan(above + 1.5);
        }
      }
    });

    it(`${map.id}: trees grow right beside the road between hairpins, but not on the rock face`, () => {
      const { trees, boxes } = buildRoadObstacles(road);
      expect(boxes.length).toBeGreaterThan(300);
      let close = 0;
      for (const t of trees) {
        let best = Infinity;
        let at = 0;
        for (let i = 0; i < road.count; i += 2) {
          const d = Math.hypot(t.x - road.x[i], t.z - road.z[i]) - road.width[i] / 2;
          if (d < best) {
            best = d;
            at = i;
          }
        }
        if (best > 5 || !(road.flags[at] & FLAG_BLIND)) continue;
        close++;
        const lateral = (t.x - road.x[at]) * Math.cos(road.yaw[at]) - (t.z - road.z[at]) * Math.sin(road.yaw[at]);
        expect(lateral > 0 ? cuts.left[at] : cuts.right[at]).toBe(0);
      }
      expect(close).toBeGreaterThan(300);
    });
  }
});
