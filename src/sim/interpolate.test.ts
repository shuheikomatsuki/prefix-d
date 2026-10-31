import { describe, expect, it } from 'vitest';
import type { CarSnapshot } from './car';
import { lerpSnapshot } from './interpolate';

const snap = (over: Partial<CarSnapshot>): CarSnapshot => ({ x: 0, y: 0, z: 0, yaw: 0, forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0, wheelSpin: 0, ...over });

describe('lerpSnapshot', () => {
  it('blends position and wheel spin', () => {
    const s = lerpSnapshot(snap({ x: 0, z: 10, wheelSpin: 0 }), snap({ x: 4, z: 20, wheelSpin: 2 }), 0.25);
    expect(s.x).toBeCloseTo(1);
    expect(s.z).toBeCloseTo(12.5);
    expect(s.wheelSpin).toBeCloseTo(0.5);
  });
  it('turns the short way across ±π', () => {
    const s = lerpSnapshot(snap({ yaw: Math.PI - 0.1 }), snap({ yaw: -Math.PI + 0.1 }), 0.5);
    expect(Math.abs(Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw)))).toBeCloseTo(Math.PI);
  });
  it('keeps the newer snapshot for other fields', () => {
    expect(lerpSnapshot(snap({ forwardSpeed: 1 }), snap({ forwardSpeed: 9 }), 0.1).forwardSpeed).toBe(9);
  });
});
