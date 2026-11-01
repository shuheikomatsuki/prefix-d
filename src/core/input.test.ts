import { describe, expect, it } from 'vitest';
import { KEY_STEER_RAMP, KEY_STEER_START, KeyboardInput, PAD_BUTTON, gamepadToDriverInput, keySteerAmount, mergeInputs } from './input';

function buttons(values: Partial<Record<number, number>>): number[] {
  return Array.from({ length: 17 }, (_, i) => values[i] ?? 0);
}

describe('gamepadToDriverInput', () => {
  it('maps triggers to throttle/brake and the left stick to steering', () => {
    const input = gamepadToDriverInput(
      [-1, 0, 0, 0],
      buttons({ [PAD_BUTTON.rightTrigger]: 0.6, [PAD_BUTTON.leftTrigger]: 0.3 }),
    );
    expect(input.throttle).toBeCloseTo(0.6);
    expect(input.brake).toBeCloseTo(0.3);
    // スティック左いっぱい → 左にハンドル（正）
    expect(input.steer).toBeCloseTo(1);
  });

  it('ignores small stick drift', () => {
    expect(gamepadToDriverInput([0.08, 0], buttons({})).steer).toBe(0);
    expect(gamepadToDriverInput([0.5, 0], buttons({})).steer).toBeLessThan(0);
  });
});

describe('mergeInputs', () => {
  it('takes the stronger of keyboard and gamepad inputs', () => {
    const merged = mergeInputs(
      { throttle: 1, brake: 0, steer: 0 },
      { throttle: 0.2, brake: 0.5, steer: -0.4 },
    );
    expect(merged).toEqual({ throttle: 1, brake: 0.5, steer: -0.4 });
  });

  it('returns keyboard input when no gamepad is connected', () => {
    const kb = { throttle: 0, brake: 1, steer: 1 };
    expect(mergeInputs(kb, null)).toBe(kb);
  });
});

describe('keySteerAmount', () => {
  it('starts small and reaches full lock after the ramp when smooth', () => {
    expect(keySteerAmount(0, true)).toBeCloseTo(KEY_STEER_START);
    expect(keySteerAmount(KEY_STEER_RAMP / 2, true)).toBeCloseTo((1 + KEY_STEER_START) / 2);
    expect(keySteerAmount(KEY_STEER_RAMP, true)).toBe(1);
    expect(keySteerAmount(5, true)).toBe(1);
  });

  it('is always full lock when not smooth', () => {
    expect(keySteerAmount(0, false)).toBe(1);
  });
});

describe('KeyboardInput steering', () => {
  /** キーのイベントを送れる、window の代わり */
  function fakeWindow() {
    const handlers = new Map<string, (e: { code: string; repeat: boolean; preventDefault: () => void }) => void>();
    const target = { addEventListener: (type: string, h: never) => handlers.set(type, h) } as unknown as Window;
    const send = (type: 'keydown' | 'keyup', code: string, repeat = false) => handlers.get(type)!({ code, repeat, preventDefault: () => {} });
    return { target, send, blur: () => (handlers.get('blur') as unknown as () => void)() };
  }

  it('deepens the steering the longer a key is held', () => {
    let now = 1000;
    const w = fakeWindow();
    const kb = new KeyboardInput(w.target, () => now);
    w.send('keydown', 'ArrowLeft');
    expect(kb.read().steer).toBeCloseTo(KEY_STEER_START);
    now += 100;
    // キーリピートで押し始めの時刻が変わらない
    w.send('keydown', 'ArrowLeft', true);
    const mid = kb.read().steer;
    expect(mid).toBeGreaterThan(KEY_STEER_START);
    expect(mid).toBeLessThan(1);
    now += KEY_STEER_RAMP * 1000;
    expect(kb.read().steer).toBe(1);
    w.send('keyup', 'ArrowLeft');
    expect(kb.read().steer).toBe(0);
  });

  it('starts over when the key is pressed again, and right steers negative', () => {
    let now = 0;
    const w = fakeWindow();
    const kb = new KeyboardInput(w.target, () => now);
    w.send('keydown', 'KeyD');
    now += 1000;
    expect(kb.read().steer).toBe(-1);
    w.send('keyup', 'KeyD');
    w.send('keydown', 'KeyD');
    expect(kb.read().steer).toBeCloseTo(-KEY_STEER_START);
    w.blur();
    expect(kb.read().steer).toBe(0);
  });

  it('steers fully at once when smoothing is off', () => {
    const w = fakeWindow();
    const kb = new KeyboardInput(w.target, () => 0);
    kb.smoothSteer = false;
    w.send('keydown', 'KeyA');
    expect(kb.read().steer).toBe(1);
  });
});
