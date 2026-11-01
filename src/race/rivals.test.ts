import { describe, expect, it } from 'vitest';
import { MAPS } from '../map/maps';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { NPC_LEVELS } from './npcDriver';
import { RIVALS, isRivalUnlocked, missedTerms, rivalsToUnlock } from './rivals';

describe('RIVALS', () => {
  it('drive existing cars on race courses at a known level', () => {
    for (const r of RIVALS) {
      expect(VEHICLE_PRESETS.some((v) => v.id === r.car)).toBe(true);
      expect(MAPS.find((m) => m.id === r.course)?.race).toBeTruthy();
      expect(NPC_LEVELS.some((l) => l.id === r.level)).toBe(true);
    }
    expect(new Set(RIVALS.map((r) => r.id)).size).toBe(RIVALS.length);
    // 得意なコースはライバルごとに別々
    expect(new Set(RIVALS.map((r) => r.course)).size).toBe(RIVALS.length);
  });

  it('give some rivals a favorite time and weather', () => {
    for (const id of ['kenta', 'sakamoto']) expect(RIVALS.find((r) => r.id === id)?.conditions).toEqual({ time: 'night', weather: 'rain' });
    expect(RIVALS.find((r) => r.id === 'takumi')?.conditions).toBeUndefined();
  });

  it('are listed from the weakest level up', () => {
    const tiers = RIVALS.map((r) => NPC_LEVELS.findIndex((l) => l.id === r.level));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });
});

describe('isRivalUnlocked', () => {
  const ids = (level: string) => RIVALS.filter((r) => r.level === level).map((r) => r.id);
  const byId = (id: string) => RIVALS.find((r) => r.id === id)!;

  it('opens the next level once every rival below is beaten', () => {
    expect(isRivalUnlocked(byId('itsuki'), new Set())).toBe(true);
    expect(isRivalUnlocked(byId('kenta'), new Set())).toBe(false);
    expect(rivalsToUnlock(byId('kenta'), new Set(['itsuki'])).map((r) => r.id)).toEqual(['iketani']);
    const easy = new Set(ids('easy'));
    expect(isRivalUnlocked(byId('kenta'), easy)).toBe(true);
    expect(isRivalUnlocked(byId('nakazato'), easy)).toBe(false);
    const normal = new Set([...easy, ...ids('normal')]);
    expect(isRivalUnlocked(byId('nakazato'), normal)).toBe(true);
    expect(isRivalUnlocked(byId('takumi'), normal)).toBe(false);
    // 上の段階まで全員でなくても、1つ下までの段階を全員倒していればよい
    expect(isRivalUnlocked(byId('takumi'), new Set([...normal, ...ids('hard')]))).toBe(true);
  });
});

describe('missedTerms', () => {
  const byId = (id: string) => RIVALS.find((r) => r.id === id)!;

  it('needs the home course, the favorite time and weather, and rough play on', () => {
    const takumi = byId('takumi');
    expect(missedTerms(takumi, { course: 'akina-down', time: 'day', weather: 'fog', rough: false })).toEqual([]);
    expect(missedTerms(takumi, { course: 'pass-down', time: 'day', weather: 'clear', rough: false })).toEqual(['course']);
    const kenta = byId('kenta');
    expect(missedTerms(kenta, { course: kenta.course, time: 'night', weather: 'rain', rough: false })).toEqual([]);
    expect(missedTerms(kenta, { course: kenta.course, time: 'day', weather: 'clear', rough: false })).toEqual(['time', 'weather']);
    const shingo = byId('shingo');
    expect(missedTerms(shingo, { course: shingo.course, time: 'day', weather: 'clear', rough: false })).toEqual(['rough']);
    expect(missedTerms(shingo, { course: shingo.course, time: 'day', weather: 'clear', rough: true })).toEqual([]);
  });
});
