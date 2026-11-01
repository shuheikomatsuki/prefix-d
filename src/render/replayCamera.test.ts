import { describe, expect, it } from 'vitest';
import { TV_OFFSET, placeStation, stationPassed, tvFov } from './replayCamera';

describe('リプレイのTV中継カメラ', () => {
  const north = { x: 0, y: 10, z: 0, yaw: 0 }; // +Z へ向かう

  it('車が来る所の左右に、道から離して高く置く', () => {
    const left = placeStation({ ...north, z: 50 }, 1);
    expect(left.x).toBeCloseTo(TV_OFFSET);
    expect(left.z).toBeCloseTo(50);
    expect(left.y).toBeGreaterThan(10);
    expect(placeStation({ ...north, z: 50 }, -1).x).toBeCloseTo(-TV_OFFSET);
  });

  it('車が近づいている間はそのまま、通り過ぎて離れたら切り替える', () => {
    const station = placeStation({ ...north, z: 60 }, 1);
    expect(stationPassed(station, { ...north, z: 0 })).toBe(false);
    expect(stationPassed(station, { ...north, z: 70 })).toBe(false);
    expect(stationPassed(station, { ...north, z: 100 })).toBe(true);
  });

  it('遠すぎるカメラ（シーク・コースアウト）は切り替える', () => {
    expect(stationPassed({ x: 0, y: 0, z: 400 }, north)).toBe(true);
  });

  it('遠い車ほど寄せて映す', () => {
    expect(tvFov(100)).toBeLessThan(tvFov(20));
    expect(tvFov(1)).toBe(60);
  });
});
