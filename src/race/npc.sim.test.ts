import { beforeAll, describe, expect, it } from 'vitest';
import { CIRCUIT_MAP, HAIRPIN_MAP, STEEP_DOWN_MAP, TECHNICAL_MAP } from '../map/maps';
import { TECHNICAL_MAP as TILE_TECHNICAL_MAP } from '../map/testMaps';
import { parseMap } from '../map/tilemap';
import { DEFAULT_VEHICLE_PARAMS, VEHICLE_PRESETS } from '../sim/vehicle';
import { buildCourse } from './course';
import { NPC_LEVELS } from './npcDriver';
import { initNpcSim, simulateBattle, simulateNpcRace } from './npcSim';
import { buildRacingLine, buildSpeedProfile, profileTime } from './racingLine';

/**
 * 実際の物理ワールドの上で NPC にレースを走らせる結合テスト（コースごとの完走は npcCourses.N.sim.test.ts）。
 */

describe('racing line', () => {
  it('stays on the road and is faster than the centerline', () => {
    const course = buildCourse(parseMap(TILE_TECHNICAL_MAP));
    const line = buildRacingLine(course);
    const limit = TILE_TECHNICAL_MAP.roadWidth / 2;
    for (let i = 0; i < line.count; i++) expect(Math.abs(line.offset[i])).toBeLessThan(limit);
    const center = buildRacingLine(course, TILE_TECHNICAL_MAP.roadWidth / 2);
    const opts = { grip: 1, brake: 1 };
    const fast = profileTime(line, buildSpeedProfile(line, DEFAULT_VEHICLE_PARAMS, opts));
    const slow = profileTime(center, buildSpeedProfile(center, DEFAULT_VEHICLE_PARAMS, opts));
    expect(fast).toBeLessThan(slow * 0.95);
  });
});

describe('NPC race', () => {
  beforeAll(initNpcSim);

  it('ranks the levels: stronger NPCs are faster when driving alone', () => {
    const times = NPC_LEVELS.map((level) => simulateNpcRace(TECHNICAL_MAP, [level]).racers[0].timer.laps[0]);
    console.log('alone', times.map((t) => t.toFixed(2)).join(' '));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]);
  }, 60000);

  it('drives the RX-7 on the circuit', () => {
    const sport = VEHICLE_PRESETS.find((v) => v.id === 'fd3s')!.params;
    const { racers } = simulateNpcRace(CIRCUIT_MAP, [NPC_LEVELS[3]], sport);
    console.log('fd3s pro', racers[0].timer.laps[0].toFixed(2), 'off', racers[0].maxOffset.toFixed(1));
    expect(racers[0].timer.phase).toBe('finished');
  }, 60000);

  it.each(VEHICLE_PRESETS.map((v) => [v.label, v] as const))('drives %s down the hairpins and the steep pass', (_, v) => {
    for (const def of [HAIRPIN_MAP, STEEP_DOWN_MAP]) {
      const { racers } = simulateNpcRace(def, [NPC_LEVELS[3]], v.params);
      console.log(v.label, def.name, racers[0].timer.laps[0]?.toFixed(2), 'off', racers[0].maxOffset.toFixed(1));
      expect(racers[0].timer.phase).toBe('finished');
      expect(racers[0].maxOffset).toBeLessThan(3);
    }
  }, 60000);
});

describe('NPC defending', () => {
  beforeAll(initNpcSim);

  it('closes the inside of the corner when a car is right behind', () => {
    const ae86 = VEHICLE_PRESETS.find((v) => v.id === 'ae86')!.params;
    // a（伝説）が b（上級）の 10m 後ろから追う
    const chase = (level: (typeof NPC_LEVELS)[number]) => simulateBattle(HAIRPIN_MAP, { level: NPC_LEVELS[4], params: ae86 }, { level, params: ae86 }, 300, 10);
    const on = chase(NPC_LEVELS[2]);
    const off = chase({ ...NPC_LEVELS[2], defend: false });
    console.log('defend', on.defendSeconds.toFixed(1), 's', on.racers.map((r) => r.timer.laps[0]?.toFixed(2)), 'off', off.racers.map((r) => r.timer.laps[0]?.toFixed(2)));
    expect(on.defendSeconds).toBeGreaterThan(3);
    expect(off.defendSeconds).toBe(0);
    for (const r of on.racers) {
      expect(r.timer.phase).toBe('finished');
      expect(r.maxOffset).toBeLessThan(3);
    }
  }, 60000);
});
