import { describe, expect, it } from 'vitest';
import { HAPPOGAHARA_MAP, SHUTOKO_MAP } from './maps';
import { guardrailAt, walledAt } from './roadObstacles';
import {
  FLAG_BRIDGE,
  FLAG_TUNNEL,
  LAYER_LOWER,
  LAYER_UPPER,
  ROAD_ORIGIN,
  type RoadModel,
  type RoadSpec,
  buildRoad,
  bumpHeight,
  closeLoop,
  reverseRoad,
} from './road';
import { buildRoadObstacles } from './roadObstacles';

const spec = (pieces: RoadSpec['pieces'], extra: Partial<RoadSpec> = {}): RoadSpec => ({ scenery: 'touge', width: 8, start: 0, pieces, ...extra });
const last = (road: RoadModel) => road.count - 1;

/** 道路の点の組で、平面では重なるのに道路に沿っては離れている所（立体交差）の高さの差の最小 */
function crossingClearance(road: RoadModel): number {
  let min = Infinity;
  for (let i = 0; i < road.count; i += 2) {
    for (let j = i + 100; j < road.count; j += 2) {
      if (road.closed && road.count - (j - i) < 100) continue;
      if (Math.hypot(road.x[i] - road.x[j], road.z[i] - road.z[j]) < (road.width[i] + road.width[j]) / 2) min = Math.min(min, Math.abs(road.h[i] - road.h[j]));
    }
  }
  return min;
}

describe('road from straights and arcs', () => {
  it('follows straights and circular arcs (left turns are positive)', () => {
    const road = buildRoad(spec([{ straight: 100 }, { arc: { radius: 50, turn: 90 } }]));
    expect(Math.abs(road.length - (100 + 25 * Math.PI))).toBeLessThan(1);
    // 東へ 100m、左（北 = -Z）へ 90° 曲がると、北を向いて (150, -50) に着く
    expect(road.x[last(road)]).toBeCloseTo(150, 0);
    expect(road.z[last(road)]).toBeCloseTo(-50, 0);
    expect(road.yaw[last(road)]).toBeCloseTo(Math.PI, 1);
    expect(road.curvature[last(road)]).toBeCloseTo(1 / 50, 5);
  });

  it('climbs between the heights given at the end of pieces, smoothly', () => {
    const road = buildRoad(spec([{ straight: 200, h: 0 }, { straight: 200, h: 20 }, { straight: 200 }]));
    expect(road.heightAt(0)).toBeCloseTo(0, 5);
    expect(road.heightAt(300)).toBeCloseTo(10, 0);
    expect(road.heightAt(590)).toBeCloseTo(20, 1);
    expect(road.gradeAt(300)).toBeCloseTo(0.1, 2);
    // 勾配の折れ目は丸める
    expect(road.gradeAt(200)).toBeGreaterThan(0.02);
    expect(road.gradeAt(200)).toBeLessThan(0.08);
  });

  it('rejects a closed road that does not come back to its start, and a crossing without height', () => {
    expect(() => buildRoad(spec([{ straight: 100 }, { arc: { radius: 30, turn: 180 } }], { closed: true }))).toThrow();
    // 自分の上を越えずに平面で交わる
    expect(() => buildRoad(spec([{ straight: 100 }, { arc: { radius: 30, turn: 330 } }, { straight: 100 }]))).toThrow(/crosses itself/);
  });

  it('turns around at the end on a loop that comes back to the same point facing the other way', () => {
    const road = buildRoad(spec([{ straight: 200 }], { turnaround: { radius: 11 } }));
    const loop = road.turnaround!.loop;
    const a = loop[0];
    const b = loop[loop.length - 1];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.01);
    expect(Math.cos(b.yaw - a.yaw)).toBeCloseTo(-1, 5);
    expect(road.turnaround!.length).toBeCloseTo((7 * Math.PI * 11) / 3, 3);
  });

  it('closes a circuit with a straight, an arc and a straight', () => {
    const right = { arc: { radius: 40, turn: -90 } };
    // 東へ 300m、南へ 200m、西へ 400m 進んで北を向いたところから閉じる
    const pieces = closeLoop(ROAD_ORIGIN, [{ straight: 300 }, right, { straight: 200 }, right, { straight: 400 }, right], 40, -1);
    expect(pieces.slice(6)).toEqual([{ straight: expect.closeTo(200, 3) }, { arc: { radius: 40, turn: expect.closeTo(-90, 3) } }, { straight: expect.closeTo(100, 3) }]);
    expect(() => buildRoad(spec(pieces, { closed: true }))).not.toThrow();
    // 曲がる向きが逆では閉じられない
    expect(() => closeLoop(ROAD_ORIGIN, [{ straight: 300 }, { arc: { radius: 40, turn: -90 } }], 50, 1)).toThrow();
  });

  it('reverses a road: the same shape and heights, driven from the other end', () => {
    const up = spec([{ straight: 100 }, { arc: { radius: 40, turn: 90 }, h: 20 }, { straight: 80 }, { arc: { radius: 30, turn: -120 } }, { straight: 60, h: 50 }]);
    const a = buildRoad(up);
    const b = buildRoad(reverseRoad(up, 10));
    expect(b.length).toBeCloseTo(a.length, 5);
    expect(b.spec.start).toBe(10);
    for (let s = 0; s <= a.length; s += 7) {
      const i = a.indexAt(s);
      const j = b.indexAt(a.length - s);
      expect(Math.hypot(a.x[i] - b.x[j], a.z[i] - b.z[j])).toBeLessThan(1.5);
      expect(b.heightAt(a.length - s)).toBeCloseTo(a.heightAt(s), 1);
    }
  });

  it('makes the bumpy section wavy and the rest flat', () => {
    const road = buildRoad(spec([{ straight: 100 }, { straight: 200, bumpy: true }, { straight: 100 }]));
    expect(bumpHeight(road, 50, 0)).toBe(0);
    const waves = Array.from({ length: 100 }, (_, i) => bumpHeight(road, 150 + i, 0));
    expect(Math.max(...waves)).toBeGreaterThan(0.03);
    expect(Math.min(...waves)).toBeLessThan(-0.03);
  });

  it('keeps a car on the ground over the bumps up to about 130 km/h', () => {
    const road = buildRoad(spec([{ straight: 100 }, { straight: 400, bumpy: true }, { straight: 100 }]));
    // 路面の高さの変化の速さ（2階微分 × 速さ^2）が、重力より小さければ車は浮かない
    const drop = (kmh: number) => {
      const v = kmh / 3.6;
      let worst = 0;
      for (let s = 150; s < 450; s += 0.25) {
        const d2 = (bumpHeight(road, s + 0.5, 0) - 2 * bumpHeight(road, s, 0) + bumpHeight(road, s - 0.5, 0)) / 0.25;
        worst = Math.max(worst, -d2 * v * v);
      }
      return worst;
    };
    expect(drop(130)).toBeLessThan(9.81);
    expect(drop(200)).toBeGreaterThan(9.81);
  });
});

describe('grade-separated crossings', () => {
  it('passes the loop bridge of the mountain pass over the road below it', () => {
    const road = buildRoad(HAPPOGAHARA_MAP.road!);
    expect(crossingClearance(road)).toBeGreaterThan(8);
    expect(road.layer.includes(LAYER_LOWER)).toBe(true);
    expect(road.layer.includes(LAYER_UPPER)).toBe(true);
  });

  it('stacks the 540 degree loop of the highway with room for the cars below', () => {
    const road = buildRoad(SHUTOKO_MAP.road!);
    expect(crossingClearance(road)).toBeGreaterThan(8);
    // 同じ向きに続けて曲がる角度の最大
    let best = 0;
    let run = 0;
    let sign = 0;
    for (let i = 0; i < road.count; i++) {
      const k = road.curvature[i];
      if (k === 0) continue;
      if (Math.sign(k) !== sign) {
        sign = Math.sign(k);
        run = 0;
      }
      run += Math.abs(k) * road.step;
      best = Math.max(best, run);
    }
    expect(best).toBeGreaterThanOrEqual(3 * Math.PI - 0.01);
  });

  it('puts the walls of the upper road on their own layer so that cars below pass under them', () => {
    const road = buildRoad(SHUTOKO_MAP.road!);
    const boxes = buildRoadObstacles(road).boxes;
    expect(boxes.some((b) => b.layer === LAYER_UPPER)).toBe(true);
    expect(boxes.some((b) => b.layer === LAYER_LOWER)).toBe(true);
    // 首都高はすべての道路の両側に壁がある（4m ごとに左右）
    expect(boxes.length).toBeGreaterThan((road.length / 4) * 2 - 4);
  });
});

describe('the four-section mountain pass', () => {
  const road = buildRoad(HAPPOGAHARA_MAP.road!);
  const pieces = HAPPOGAHARA_MAP.road!.pieces;

  it('has a narrow first section, a wide bumpy second section and a high bridge', () => {
    expect(road.widthAt(300)).toBeLessThan(7);
    const bumpy = pieces.findIndex((p) => p.bumpy);
    expect(road.widthAt(road.pieceStart[bumpy] + 100)).toBeGreaterThanOrEqual(10);
    const bridge = pieces.findIndex((p) => p.valley);
    expect(pieces[bridge].valley).toBeGreaterThanOrEqual(50);
    expect(road.hasFlag(road.pieceStart[bridge] + 100, FLAG_BRIDGE)).toBe(true);
  });

  it('has guardrails only along the widened second section', () => {
    const bumpy = pieces.findIndex((p) => p.bumpy);
    const at = (s: number) => Math.round(s / road.step);
    expect(guardrailAt(road, at(road.pieceStart[bumpy] + 100))).toBe(true);
    expect(walledAt(road, at(road.pieceStart[bumpy] + 100))).toBe(true);
    expect(guardrailAt(road, at(300))).toBe(false);
    expect(walledAt(road, at(300))).toBe(false);
  });

    it('goes downhill after the high point and steeply uphill after the bridge', () => {
    const high = road.pieceStart[pieces.findIndex((p) => p.h === 70) + 1];
    const bridge = pieces.findIndex((p) => p.valley);
    expect(road.heightAt(road.pieceStart[bridge]) - road.heightAt(high)).toBeLessThan(-50);
    expect(road.heightAt(road.length) - road.heightAt(road.pieceStart[bridge + 1])).toBeGreaterThan(80);
  });

  it('runs on a flat road for a while after the climb before the U-turn', () => {
    // 頂上の広場の手前 150m は、ほとんど平ら
    for (let s = road.length - 150; s < road.length; s += 5) {
      expect(Math.abs(road.heightAt(s + 5) - road.heightAt(s)) / 5).toBeLessThan(0.01);
    }
    expect(road.heightAt(road.length) - road.heightAt(road.length - 300)).toBeGreaterThan(8);
  });

  it('has a long tunnel in a corner', () => {
    const tunnel = pieces.findIndex((p) => p.tunnel && p.arc);
    expect(tunnel).toBeGreaterThan(0);
    let length = 0;
    for (let i = 0; i < road.count; i++) if (road.flags[i] & FLAG_TUNNEL) length += road.step;
    expect(length).toBeGreaterThan(200);
  });
});
