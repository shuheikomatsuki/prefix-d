import { describe, expect, it } from 'vitest';
import { MAPS } from '../map/maps';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { carStats, driveOf } from './carStats';
import { COURSE_NOTES, courseProfile, profilePath } from './courseInfo';

describe('course profile for the menu', () => {
  it('has a note and existing recommended cars for every map', () => {
    for (const m of MAPS) {
      const note = COURSE_NOTES[m.id];
      expect(note, m.id).toBeDefined();
      for (const car of note.cars) expect(VEHICLE_PRESETS.some((v) => v.id === car), `${m.id}: ${car}`).toBe(true);
    }
  });

  it('measures the out-and-back mountain pass', () => {
    const p = courseProfile(MAPS.find((m) => m.id === 'happogahara')!);
    expect(p.kind).toBe('roundtrip');
    expect(p.length).toBeGreaterThan(6000);
    expect(p.rise).toBeGreaterThan(90);
    expect(p.features).toContain('トンネル');
    expect(p.features).toContain('立体交差');
    // 往復なので、スタートとゴールは同じ高さ
    expect(p.heights[0]).toBeCloseTo(p.heights[p.heights.length - 1], 0);
  });

  it('treats the town as a free roam map and the Shutoko as a loop', () => {
    expect(courseProfile(MAPS[0]).kind).toBe('free');
    const shutoko = courseProfile(MAPS.find((m) => m.id === 'shutoko-c1')!);
    expect(shutoko.kind).toBe('loop');
    expect(shutoko.length).toBeGreaterThan(3000);
  });

  it('builds both Irohazaka roads with the real lengths, rise and curve counts', () => {
    const up = MAPS.find((m) => m.id === 'iroha-up')!;
    const down = MAPS.find((m) => m.id === 'iroha-down')!;
    const curves = (m: typeof up) => m.road!.pieces.filter((p) => p.arc && Math.abs(p.arc.turn) >= 45).length;
    expect(curves(up)).toBe(20);
    expect(curves(down)).toBe(28);
    const pu = courseProfile(up);
    const pd = courseProfile(down);
    expect(pu.length).toBeGreaterThan(9000);
    expect(pd.length).toBeGreaterThan(6000);
    expect(pu.heights[pu.heights.length - 1] - pu.heights[0]).toBeCloseTo(440, -1);
    expect(pd.heights[0] - pd.heights[pd.heights.length - 1]).toBeCloseTo(440, -1);
  });

  it('fits the elevation graph into the box', () => {
    const pts = profilePath([0, 50, 100], 200, 60);
    expect(pts[0].x).toBe(4);
    expect(pts[2].x).toBe(196);
    expect(pts[2].y).toBeLessThan(pts[0].y);
    for (const p of pts) expect(p.y).toBeGreaterThanOrEqual(0);
  });
});

describe('car stats for the menu', () => {
  it('rates every stat between 0 and 1 with the fastest car on top', () => {
    const fastest = VEHICLE_PRESETS.find((v) => v.id === 'r34')!;
    const kei = VEHICLE_PRESETS.find((v) => v.id === 'kei')!;
    expect(carStats(fastest)[0].value).toBe(1);
    expect(carStats(kei)[0].value).toBeLessThan(0.3);
    for (const v of VEHICLE_PRESETS) for (const s of carStats(v)) expect(s.value).toBeGreaterThan(0);
    expect(carStats(fastest)[0].text).toBe('285 km/h');
  });

  it('reads the drive type from the description', () => {
    expect(driveOf(VEHICLE_PRESETS.find((v) => v.id === 'ae86')!)).toBe('FR');
    expect(driveOf(VEHICLE_PRESETS.find((v) => v.id === 'evo')!)).toBe('4WD');
    expect(driveOf(VEHICLE_PRESETS.find((v) => v.id === 'standard')!)).toBeNull();
  });
});
