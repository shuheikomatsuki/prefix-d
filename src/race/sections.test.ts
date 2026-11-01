import { describe, expect, it } from 'vitest';
import { SectionClock, compareSections, sectionCount, sectionPaths } from './sections';

/** 一定の速さ speed [m/s] で走ったときの記録（dt ごと） */
function run(clock: SectionClock, speed: number, until: number, dt = 0.1): void {
  for (let t = 0; t <= until + 1e-9; t += dt) clock.update(t, t * speed);
}

describe('sectionCount', () => {
  it('splits by length within limits', () => {
    expect(sectionCount(500)).toBe(3);
    expect(sectionCount(3500)).toBe(5);
    expect(sectionCount(20000)).toBe(8);
  });
});

describe('SectionClock', () => {
  it('records the time each boundary is crossed', () => {
    const c = new SectionClock(300, 3, 1);
    run(c, 10, 25);
    // 100 m・200 m の区切りを 10 s・20 s に通る（ゴールは finish で記録）
    expect(c.times).toHaveLength(2);
    expect(c.times[0]).toBeCloseTo(10);
    expect(c.times[1]).toBeCloseTo(20);
    c.finish(30);
    expect(c.sectionTime(2)).toBeCloseTo(10);
  });

  it('counts boundaries across laps', () => {
    const c = new SectionClock(100, 2, 2);
    run(c, 10, 18);
    expect(c.times.map((t) => Math.round(t))).toEqual([5, 10, 15]);
  });

  it('ignores progress while off course and after a jump', () => {
    const c = new SectionClock(300, 3, 1);
    c.update(0, 80);
    c.update(1, 120, false);
    expect(c.times).toHaveLength(0);
    // 戻されて、そこから走り直す
    c.update(3, 85);
    c.update(4, 110);
    expect(c.times).toHaveLength(1);
    expect(c.times[0]).toBeCloseTo(3.6);
    // 大きな飛び（近道の先へ戻されたなど）は区切りを通ったことにしない
    c.update(5, 250);
    expect(c.times).toHaveLength(1);
    // そこから走り続けたら、記録が止まらない
    c.update(6, 255);
    expect(c.times).toHaveLength(2);
    expect(c.times[1]).toBeCloseTo(6);
  });
});

describe('compareSections', () => {
  it('finds where time was lost and gained', () => {
    const me = new SectionClock(300, 3, 1);
    const them = new SectionClock(300, 3, 1);
    me.times.push(10, 25, 33);
    them.times.push(11, 21, 31);
    const r = compareSections(me, them);
    expect(r.gaps[0]).toBeCloseTo(-1);
    expect(r.gaps[1]).toBeCloseTo(5);
    expect(r.gaps[2]).toBeCloseTo(-2);
    expect(r.worst).toBe(1);
    expect(r.best).toBe(2);
  });

  it('sums the same section over laps and skips sections not yet run', () => {
    const me = new SectionClock(100, 2, 2);
    const them = new SectionClock(100, 2, 2);
    me.times.push(5, 10, 16, 21);
    them.times.push(6, 10);
    const r = compareSections(me, them);
    expect(r.gaps[0]).toBeCloseTo(-1);
    expect(r.gaps[1]).toBeCloseTo(1);
    const partial = compareSections(new SectionClock(300, 3, 1), them);
    expect(partial.gaps.every((g) => g === null)).toBe(true);
    expect(partial.worst).toBeNull();
  });
});

describe('sectionPaths', () => {
  it('splits the centre line into consecutive pieces', () => {
    const course = { length: 300, pointAt: (s: number) => ({ x: s, z: 0, yaw: 0, curvature: 0 }) };
    const paths = sectionPaths(course, 3, 4);
    expect(paths).toHaveLength(3);
    expect(paths[1][0].x).toBeCloseTo(100);
    expect(paths[1][4].x).toBeCloseTo(200);
  });
});
