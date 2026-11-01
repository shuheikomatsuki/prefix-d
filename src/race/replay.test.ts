import { describe, expect, it } from 'vitest';
import { GHOST_INTERVAL, GhostRecorder, INPUT_STRIDE, encodeTelemetry, inputsMatch, telemetryAt } from './ghost';
import { type Replay, type ReplayTrack, ReplayClock, frameAt, lapMarks, replayDuration, steerLabel, trackDuration } from './replay';

/** 直線を 20m/s で走り、途中から左に切ってブレーキを踏む記録 */
function recordedTrack(seconds = 3): ReplayTrack {
  const rec = new GhostRecorder();
  for (let t = 0; t <= seconds + 1e-9; t += 1 / 60) {
    const braking = t >= 1;
    rec.sample(t, { x: 0, z: t * 20, yaw: 0 }, { steer: braking ? 0.5 : 0, throttle: braking ? 0 : 1, brake: braking ? 0.8 : 0, speed: 20, understeer: braking ? 0.3 : 0 });
  }
  return { name: 'me', car: 'ae86', color: 0xff0000, isPlayer: true, ghost: rec.frames, inputs: rec.inputs };
}

describe('telemetry', () => {
  it('records one set of inputs per ghost point, as integers', () => {
    const track = recordedTrack();
    expect(inputsMatch(track.inputs, track.ghost.length)).toBe(true);
    expect(track.inputs.every(Number.isInteger)).toBe(true);
    expect(telemetryAt(track.inputs, 0)).toEqual({ steer: 0, throttle: 1, brake: 0, speed: 20, understeer: 0 });
    expect(telemetryAt(track.inputs, 10_000)).toBeNull();
  });

  it('clamps values out of range and broken numbers', () => {
    expect(encodeTelemetry({ steer: -3, throttle: 2, brake: Number.NaN, speed: 12.34, understeer: -1 })).toEqual([-100, 100, 0, 123, 0]);
    expect(encodeTelemetry({ steer: 0, throttle: 0, brake: 0, speed: 0, understeer: 0 })).toHaveLength(INPUT_STRIDE);
  });

  it('fills zeros when a sample has no inputs (keeps the two lists aligned)', () => {
    const rec = new GhostRecorder();
    rec.sample(0, { x: 0, z: 0, yaw: 0 });
    rec.sample(GHOST_INTERVAL, { x: 0, z: 1, yaw: 0 });
    expect(inputsMatch(rec.inputs, rec.frames.length)).toBe(true);
  });
});

describe('frameAt', () => {
  it('interpolates position and inputs between points', () => {
    const track = recordedTrack();
    const f = frameAt(track, 0.55)!;
    // 記録は 60Hz の物理ステップごとに取るので、最大 1/60 秒（20m/s で 0.33m）先の位置になる
    expect(f.z).toBeGreaterThanOrEqual(11);
    expect(f.z).toBeLessThan(11 + 20 / 60 + 1e-6);
    expect(f.throttle).toBe(1);
    expect(f.hasInputs).toBe(true);
    const later = frameAt(track, 2)!;
    expect(later.steer).toBeCloseTo(0.5);
    expect(later.brake).toBeCloseTo(0.8);
    expect(later.understeer).toBeCloseTo(0.3);
  });

  it('holds the first and last point outside the recording', () => {
    const track = recordedTrack();
    expect(frameAt(track, -1)!.z).toBe(0);
    const end = frameAt(track, 99)!;
    expect(end.ended).toBe(true);
    expect(end.z).toBeCloseTo(track.ghost[track.ghost.length - 2]);
    expect(end.speed).toBe(0);
  });

  it('works out the speed from the positions when there are no inputs (old records)', () => {
    const track = { ...recordedTrack(), inputs: [] };
    const f = frameAt(track, 1.23)!;
    expect(f.hasInputs).toBe(false);
    expect(f.speed).toBeCloseTo(20, 0);
    expect(f.throttle).toBe(0);
  });

  it('turns the shorter way across ±π', () => {
    const track: ReplayTrack = { name: 'x', car: 'x', color: 0, isPlayer: false, ghost: [0, 0, 3.1, 0, 1, -3.1], inputs: [] };
    expect(Math.abs(frameAt(track, GHOST_INTERVAL / 2)!.yaw)).toBeGreaterThan(3.1);
  });

  it('returns null for an empty recording', () => {
    expect(frameAt({ name: 'x', car: 'x', color: 0, isPlayer: false, ghost: [], inputs: [] }, 0)).toBeNull();
  });
});

describe('replay length and marks', () => {
  it('lasts as long as the longest track', () => {
    const a = recordedTrack(3);
    const b = recordedTrack(5);
    const replay: Replay = { course: 'c', title: 't', tracks: [a, b], marks: [] };
    // 最後の点は 1/60 秒の刻みの誤差で、ちょうどの時刻より 1 点少ないことがある
    expect(Math.abs(trackDuration(a) - 3)).toBeLessThanOrEqual(GHOST_INTERVAL + 1e-9);
    expect(replayDuration(replay)).toBe(trackDuration(b));
    expect(trackDuration(b)).toBeGreaterThan(trackDuration(a) + 1.8);
  });

  it('marks the end of every lap and the finish', () => {
    expect(lapMarks([30, 29, 28.5])).toEqual([
      { time: 30, label: '1周' },
      { time: 59, label: '2周' },
      { time: 87.5, label: 'ゴール' },
    ]);
  });

  it('describes the steering (left is positive, like the car)', () => {
    expect(steerLabel(0.005)).toBe('まっすぐ');
    expect(steerLabel(0.35)).toBe('左 35%');
    expect(steerLabel(-1)).toBe('右 100%');
  });
});

describe('ReplayClock', () => {
  it('plays at the chosen speed and stops at the end', () => {
    const c = new ReplayClock(10);
    c.update(1);
    expect(c.time).toBe(1);
    c.changeSpeed(1);
    expect(c.speed).toBe(2);
    c.update(1);
    expect(c.time).toBe(3);
    c.changeSpeed(-2);
    expect(c.speed).toBe(0.5);
    expect(c.update(100)).toBe(7);
    expect(c.playing).toBe(false);
  });

  it('pauses, seeks within the replay, and restarts from the top at the end', () => {
    const c = new ReplayClock(10);
    c.toggle();
    expect(c.update(1)).toBe(0);
    c.seek(-5);
    expect(c.time).toBe(0);
    c.seek(50);
    expect(c.time).toBe(10);
    c.toggle();
    expect(c.playing).toBe(true);
    expect(c.time).toBe(0);
  });

  it('keeps the speed within the steps', () => {
    const c = new ReplayClock(10);
    for (let i = 0; i < 10; i++) c.changeSpeed(1);
    expect(c.speed).toBe(4);
    c.setSpeed(3);
    expect(c.speed).toBe(4);
    c.setSpeed(0.25);
    expect(c.speed).toBe(0.25);
  });
});
