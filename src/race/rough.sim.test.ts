import { beforeAll, describe, expect, it } from 'vitest';
import { MAPS } from '../map/maps';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { NPC_LEVELS, carsTouching } from './npcDriver';
import { initNpcSim, simulateBattle } from './npcSim';
import { RIVALS, rivalLevel } from './rivals';

/**
 * ラフプレー（ライバルがコーナーの手前でぶつけてくる）の結合テスト。
 * ライバルが後ろからスタートし、遅いプレイヤー役（NPC の初級）に追いついたところでぶつける
 */

describe('carsTouching', () => {
  it('前後・左右が車の長さ・幅くらいより近ければ触れている', () => {
    const a = { x: 0, z: 0, yaw: 0 };
    expect(carsTouching(a, { x: 0, z: 4 })).toBe(true);
    expect(carsTouching(a, { x: 1.8, z: 1 })).toBe(true);
    expect(carsTouching(a, { x: 2.5, z: 0 })).toBe(false);
    expect(carsTouching(a, { x: 0, z: 6 })).toBe(false);
    expect(carsTouching(null, { x: 0, z: 0 })).toBe(false);
  });
});

describe('rough play', () => {
  beforeAll(initNpcSim);

  const shingo = RIVALS.find((r) => r.id === 'shingo')!;
  const map = MAPS.find((m) => m.id === shingo.course)!;
  const params = VEHICLE_PRESETS.find((v) => v.id === shingo.car)!.params;
  const player = { level: NPC_LEVELS[0], params };

  it('only the rivals that play rough can choose it', () => {
    expect(RIVALS.filter((r) => r.rough).map((r) => r.id)).toEqual(['shingo', 'tachi', 'rin']);
  });

  it('rams the player in the corners, and keeps itself on the road', () => {
    const { hits, racers } = simulateBattle(map, { level: rivalLevel(shingo), params, rough: shingo.rough }, player, 240, 10);
    console.log('rough hits', hits, racers.map((r) => `${r.timer.phase} ${r.timer.time.toFixed(1)} off ${r.maxOffset.toFixed(1)} fell ${r.fell}`).join(' | '));
    expect(hits).toBeGreaterThan(0);
    expect(racers[0].timer.phase).toBe('finished');
    expect(racers[0].fell).toBe(false);
  }, 120000);

  it('Tachi only nudges: a light, short hit from behind on the inside', () => {
    const tachi = RIVALS.find((r) => r.id === 'tachi')!;
    const style = tachi.rough!;
    expect(style.push).toBeLessThan(shingo.rough!.push / 2);
    expect(style.spin).toBeLessThan(shingo.rough!.spin / 2);
    const tmap = MAPS.find((m) => m.id === tachi.course)!;
    const tparams = VEHICLE_PRESETS.find((v) => v.id === tachi.car)!.params;
    const { hits, racers } = simulateBattle(tmap, { level: rivalLevel(tachi), params: tparams, rough: style }, { level: NPC_LEVELS[0], params: tparams }, 420, 10);
    console.log('tachi hits', hits, racers.map((r) => `${r.timer.phase} ${r.timer.time.toFixed(1)} off ${r.maxOffset.toFixed(1)} fell ${r.fell}`).join(' | '));
    expect(hits).toBeGreaterThan(0);
    expect(racers[0].timer.phase).toBe('finished');
    expect(racers[0].fell).toBe(false);
    // 姿勢を崩すだけで、相手は落ちずに走りきる
    expect(racers[1].fell).toBe(false);
  }, 120000);

  it('does not ram without rough play', () => {
    const { hits, attackSeconds, racers } = simulateBattle(map, { level: rivalLevel(shingo), params }, player, 240, 10);
    expect(hits).toBe(0);
    expect(attackSeconds).toBe(0);
    expect(racers[0].timer.phase).toBe('finished');
  }, 120000);
});
