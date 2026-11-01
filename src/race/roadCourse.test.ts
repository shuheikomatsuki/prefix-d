import { describe, expect, it } from 'vitest';
import { HAPPOGAHARA_MAP } from '../map/maps';
import { STACKED_LOOP_MAP } from '../map/testMaps';
import { buildRoad } from '../map/road';
import { parseMap } from '../map/tilemap';
import { type RoadCourse, buildRoadCourse } from './roadCourse';
import { TimeAttack } from './timeAttack';

const course = (def: typeof HAPPOGAHARA_MAP) => buildRoadCourse(parseMap(def), buildRoad(def.road!));

/** コースに沿って from から to まで step [m] ずつ走らせる */
function drive(race: TimeAttack, c: RoadCourse, from: number, to: number, step = 2) {
  for (let s = from; s <= to; s += step) {
    const p = c.pointAt(s);
    race.update(0.1, { x: p.x, z: p.z, vx: Math.sin(p.yaw) * 20, vz: Math.cos(p.yaw) * 20 });
  }
}

describe('out-and-back course', () => {
  const c = course(HAPPOGAHARA_MAP);
  const road = c.road;

  it('goes up the road, turns around at the top and comes back to the start line', () => {
    expect(c.closed).toBe(false);
    expect(c.length).toBeCloseTo(2 * road.length + road.turnaround!.length - 2 * road.spec.start, -1);
    const start = c.pointAt(0);
    const finish = c.pointAt(c.length);
    expect(Math.hypot(start.x - finish.x, start.z - finish.z)).toBeLessThan(0.5);
    expect(Math.cos(start.yaw - finish.yaw)).toBeCloseTo(-1, 3);
    // 行きと帰りの同じ場所は同じ高さで、坂の向きは逆
    expect(c.heightAt(500)).toBeCloseTo(c.heightAt(c.length - 500), 1);
    expect(c.gradeAt(500)).toBeCloseTo(-c.gradeAt(c.length - 500), 2);
  });

  it('changes the height smoothly along the course, also on the way back', () => {
    // 道路の点の間で高さが段になっていると、坂で車が跳ね続ける
    for (const from of [700, c.length - 700]) {
      let maxStep = 0;
      for (let s = from; s < from + 20; s += 0.1) maxStep = Math.max(maxStep, Math.abs(c.heightAt(s + 0.1) - c.heightAt(s)));
      expect(maxStep).toBeLessThan(0.03);
    }
  });

  it('tells the way up from the way back at the same place', () => {
    const p = c.pointAt(500);
    expect(c.project(p.x, p.z, { s: 490 }).s).toBeCloseTo(500, 0);
    expect(c.project(p.x, p.z, { s: c.length - 510 }).s).toBeCloseTo(c.length - 500, 0);
    // 手がかりがなくても、進む向きで分かる
    const back = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) };
    expect(c.project(p.x, p.z, { dir: back }).s).toBeCloseTo(c.length - 500, 0);
  });

  it('finishes after the round trip, also when turning back without going around the plaza', () => {
    const full = new TimeAttack(c, 1);
    full.update(3.1, { x: 0, z: 0, vx: 0, vz: 0 });
    drive(full, c, -5, c.length + 5);
    expect(full.phase).toBe('finished');

    // 広場の手前で向きを変えて戻る（輪を回らない）
    const quick = new TimeAttack(c, 1);
    quick.update(3.1, { x: 0, z: 0, vx: 0, vz: 0 });
    const top = road.length - road.spec.start;
    drive(quick, c, -5, top - 4);
    const loop = road.turnaround!.length;
    drive(quick, c, top + loop + 4, c.length + 5);
    expect(quick.phase).toBe('finished');
  });

  it('does not finish when coming back before reaching the top', () => {
    const race = new TimeAttack(c, 1);
    race.update(3.1, { x: 0, z: 0, vx: 0, vz: 0 });
    drive(race, c, -5, 1000);
    // 途中で引き返して、スタートラインへ戻る
    for (let s = 1000; s >= -5; s -= 2) {
      const p = c.pointAt(s);
      race.update(0.1, { x: p.x, z: p.z, vx: -Math.sin(p.yaw) * 20, vz: -Math.cos(p.yaw) * 20 });
    }
    expect(race.phase).toBe('racing');
  });
});

describe('closed course with loops over itself', () => {
  const c = course(STACKED_LOOP_MAP);

  it('counts laps by following the course across the crossings', () => {
    const race = new TimeAttack(c, 2);
    race.update(3.1, { x: 0, z: 0, vx: 0, vz: 0 });
    drive(race, c, -5, 2 * c.length + 5);
    expect(race.phase).toBe('finished');
    expect(race.laps.length).toBe(2);
  });

  it('keeps the lower and the upper road apart at the stacked loop', () => {
    const road = c.road;
    // 二重のループで、下の輪と上の輪が平面で重なる点
    const i = road.layer.findIndex((l) => l === 1) + 40;
    const lower = { x: road.x[i], z: road.z[i] };
    const sLower = i * road.step - road.spec.start;
    const upper = c.project(lower.x, lower.z, { s: sLower + 2 * Math.PI * 55 });
    expect(upper.s).toBeGreaterThan(sLower + 300);
    expect(c.heightAt(upper.s) - c.heightAt(sLower)).toBeGreaterThan(8);
    expect(c.project(lower.x, lower.z, { s: sLower - 5 }).s).toBeCloseTo(sLower, 0);
  });
});
