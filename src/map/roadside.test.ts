import { describe, expect, it } from 'vitest';
import { IROHA_UP_MAP, MYOGI_UP_MAP, SHUTOKO_MAP, VALLEY_UP_MAP } from './maps';
import { FLAG_BRIDGE, FLAG_TUNNEL, buildRoad } from './road';
import { buildRoadCuts } from './roadCuts';
import { CHEVRON_CURVATURE, roadsideProps } from './roadside';

describe('道ばたの小物', () => {
  for (const map of [IROHA_UP_MAP, MYOGI_UP_MAP, VALLEY_UP_MAP]) {
    const road = buildRoad(map.road!);
    const props = roadsideProps(road, buildRoadCuts(road));

    it(`${map.id}: 視線誘導標・矢印板が並び、どれも路面から外れた路肩にある`, () => {
      expect(props.some((p) => p.kind === 'delineator')).toBe(true);
      expect(props.some((p) => p.kind === 'chevron')).toBe(true);
      for (const p of props) {
        // いちばん近い道路の点から、道幅の半分より外
        let best = Infinity;
        let bi = 0;
        for (let i = 0; i < road.count; i++) {
          const d = Math.hypot(p.x - road.x[i], p.z - road.z[i]);
          if (d < best) {
            best = d;
            bi = i;
          }
        }
        expect(best).toBeGreaterThan(road.width[bi] / 2 + 0.4);
        expect(best).toBeLessThan(road.width[bi] / 2 + 2.5);
        expect(road.flags[bi] & (FLAG_BRIDGE | FLAG_TUNNEL)).toBe(0);
      }
    });

    it(`${map.id}: 矢印板はきついカーブの外側で、曲がる向きを指す`, () => {
      for (const p of props.filter((q) => q.kind === 'chevron')) {
        let bi = 0;
        let best = Infinity;
        for (let i = 0; i < road.count; i++) {
          const d = Math.hypot(p.x - road.x[i], p.z - road.z[i]);
          if (d < best) {
            best = d;
            bi = i;
          }
        }
        const k = road.curvature[bi];
        if (Math.abs(k) < CHEVRON_CURVATURE * 0.8) continue;
        // 左カーブ（曲率が正）なら右側（-1）に立ち、矢印は左（+1）
        expect(p.turn).toBe(Math.sign(k));
        expect(p.side).toBe(-Math.sign(k));
      }
    });
  }

  it('首都高には置かない', () => {
    expect(roadsideProps(buildRoad(SHUTOKO_MAP.road!), null)).toEqual([]);
  });
});
