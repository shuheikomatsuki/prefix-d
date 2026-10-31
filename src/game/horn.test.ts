import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HORN_MAX_MS, HORN_RANGE, Horns, hornVolume } from './horn';

const fakeSound = () => {
  const playing = new Map<number | 'me', number>();
  return {
    playing,
    horn: (id: number | 'me', on: boolean, volume = 1) => (on ? playing.set(id, volume) : playing.delete(id)),
    setHornVolume: (id: number, volume: number) => playing.has(id) && playing.set(id, volume),
  };
};

describe('Horns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('sounds my horn while either the key or the button is held, and tells the room once per change', () => {
    const sound = fakeSound();
    const sent: boolean[] = [];
    const horns = new Horns(sound, (on) => sent.push(on), () => null);
    horns.input.key = true;
    horns.update();
    horns.input.touch = true;
    horns.update();
    horns.input.key = false;
    horns.update();
    expect(sound.playing.has('me')).toBe(true);
    horns.input.touch = false;
    horns.update();
    expect(sound.playing.has('me')).toBe(false);
    expect(sent).toEqual([true, false]);
  });

  it('plays a remote horn quieter when far away and follows the distance', () => {
    const sound = fakeSound();
    let d = HORN_RANGE / 2;
    const horns = new Horns(sound, () => {}, () => d);
    horns.remote(7, true);
    expect(sound.playing.get(7)).toBeCloseTo(0.5);
    d = 0;
    horns.updateVolumes();
    expect(sound.playing.get(7)).toBeCloseTo(1);
    horns.remote(7, false);
    expect(sound.playing.has(7)).toBe(false);
  });

  it('stops a remote horn whose stop message never arrived', () => {
    const sound = fakeSound();
    const horns = new Horns(sound, () => {}, () => 0);
    horns.remote(3, true);
    vi.advanceTimersByTime(HORN_MAX_MS + 1);
    expect(sound.playing.has(3)).toBe(false);
  });

  it('stops every remote horn when the connection drops', () => {
    const sound = fakeSound();
    const horns = new Horns(sound, () => {}, () => 0);
    horns.remote(1, true);
    horns.remote(2, true);
    horns.stopRemote();
    expect(sound.playing.size).toBe(0);
  });

  it('cannot be heard beyond the range', () => {
    expect(hornVolume(HORN_RANGE * 2)).toBe(0);
  });
});
