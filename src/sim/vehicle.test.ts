import { describe, expect, it } from 'vitest';
import { DEFAULT_VEHICLE_PARAMS, KEY_STEER_OVER, keySteerLimit } from './vehicle';
import {
  type DriverInput,
  type VehicleState,
  DEFAULT_VEHICLE_PARAMS as P,
  NEUTRAL_INPUT,
  VEHICLE_PRESETS,
  accelTimeOf,
  cornerGripShare,
  driveAccelAt,
  lateralAccelAt,
  steerLimitAt,
  stepVehicle,
  topSpeedOf,
} from './vehicle';

const DT = 1 / 60;
const REST: VehicleState = { forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0 };

function run(state: VehicleState, input: Partial<DriverInput>, seconds: number) {
  let s = { ...state, yawRate: 0, understeer: 0, gripAngle: 0 };
  const full = { ...NEUTRAL_INPUT, ...input };
  for (let i = 0; i < Math.round(seconds / DT); i++) s = stepVehicle(s, full, P, DT);
  return s;
}

describe('stepVehicle', () => {
  it('accelerates forward with throttle and never exceeds max speed', () => {
    const after2s = run(REST, { throttle: 1 }, 2);
    expect(after2s.forwardSpeed).toBeGreaterThan(8);
    const after60s = run(REST, { throttle: 1 }, 60);
    expect(after60s.forwardSpeed).toBeLessThanOrEqual(P.maxForwardSpeed);
    expect(after60s.forwardSpeed).toBeGreaterThan(P.maxForwardSpeed * 0.8);
  });

  it('brakes to a stop from cruising speed within a few seconds', () => {
    const cruising = { ...REST, forwardSpeed: 20 };
    // 8.2 m/s^2（約 0.85G）なら 2 秒で 20 → 4 m/s 程度まで落ちる
    const s = run(cruising, { brake: 1 }, 2.0);
    expect(s.forwardSpeed).toBeLessThan(5);
    expect(s.forwardSpeed).toBeGreaterThanOrEqual(0);
  });

  it('reverses when brake is held at standstill, up to max reverse speed', () => {
    const s = run(REST, { brake: 1 }, 20);
    expect(s.forwardSpeed).toBeLessThan(0);
    expect(s.forwardSpeed).toBeGreaterThanOrEqual(-P.maxReverseSpeed);
  });

  it('throttle while reversing acts as a brake first', () => {
    const reversing = { ...REST, forwardSpeed: -5 };
    const s = run(reversing, { throttle: 1 }, 0.1);
    expect(s.forwardSpeed).toBeGreaterThan(-5);
    expect(s.forwardSpeed).toBeLessThanOrEqual(0);
  });

  it('coasts to a stop without reversing direction', () => {
    const s = run({ ...REST, forwardSpeed: 10 }, {}, 60);
    expect(s.forwardSpeed).toBe(0);
  });

  it('turns left with positive steer and right with negative steer', () => {
    const moving = { ...REST, forwardSpeed: 10 };
    const left = run(moving, { throttle: 0.3, steer: 1 }, 0.5);
    const right = run(moving, { throttle: 0.3, steer: -1 }, 0.5);
    expect(left.yawRate).toBeGreaterThan(0);
    expect(right.yawRate).toBeLessThan(0);
    expect(left.yawRate).toBeCloseTo(-right.yawRate, 6);
  });

  it('does not rotate when standing still even with full steer', () => {
    const s = run(REST, { steer: 1 }, 1);
    expect(s.yawRate).toBe(0);
    expect(s.steerAngle).toBeCloseTo(P.maxSteerAngle, 6);
  });

  it('returns the steering to center when released', () => {
    const steered = run({ ...REST, forwardSpeed: 5 }, { steer: 1 }, 1);
    expect(steered.steerAngle).toBeGreaterThan(0.3);
    const released = run(steered, {}, 1);
    expect(released.steerAngle).toBe(0);
  });

  it('limits the steering angle at high speed', () => {
    expect(steerLimitAt(0, P)).toBe(P.maxSteerAngle);
    expect(steerLimitAt(30, P)).toBeLessThan(steerLimitAt(10, P));
    // 高速旋回時の横加速度が上限以下
    const v = 30;
    const lateral = (v * v * Math.tan(steerLimitAt(v, P))) / P.wheelBase;
    expect(lateral).toBeLessThanOrEqual(lateralAccelAt(v, P) + 1e-9);
  });

  it('grips a little harder at high speed (downforce)', () => {
    expect(lateralAccelAt(10, P)).toBe(P.maxLateralAccel);
    expect(lateralAccelAt(40, P)).toBeGreaterThan(P.maxLateralAccel * 1.05);
    expect(lateralAccelAt(40, P)).toBeLessThan(P.maxLateralAccel * 1.15);
    expect(lateralAccelAt(60, P)).toBe(lateralAccelAt(40, P));
    // FD なら 100km/h で半径 80m のカーブを曲がれる（約 1G）
    const fd = VEHICLE_PRESETS.find((c) => c.id === 'fd3s')!.params;
    const v = 100 / 3.6;
    expect((v * v * Math.tan(steerLimitAt(v, fd))) / fd.wheelBase).toBeGreaterThanOrEqual((v * v) / 80);
  });

  it('damps lateral sliding', () => {
    const s = run({ ...REST, forwardSpeed: 10, lateralSpeed: 5 }, {}, 1);
    expect(Math.abs(s.lateralSpeed)).toBeLessThan(0.01);
  });
});

describe('sharing the tyre grip between braking and cornering (friction circle)', () => {
  it('leaves less grip for cornering the harder the brake is pressed, but some even at full brake (ABS)', () => {
    expect(cornerGripShare(0)).toBe(1);
    expect(cornerGripShare(0.5)).toBeCloseTo(Math.sqrt(0.75));
    expect(cornerGripShare(1)).toBeGreaterThan(0.2);
    expect(cornerGripShare(1)).toBeLessThan(0.5);
    expect(cornerGripShare(0.3)).toBeGreaterThan(cornerGripShare(0.7));
  });

  it('turns much less with full brake and full steer than with full steer alone', () => {
    const cruising: VehicleState = { forwardSpeed: 25, lateralSpeed: 0, steerAngle: 0 };
    const coast = run(cruising, { steer: 1 }, 0.4);
    const braking = run(cruising, { steer: 1, brake: 1 }, 0.4);
    // 横加速度 = 速さ × ヨーレート
    const latCoast = coast.forwardSpeed * coast.yawRate;
    const latBraking = braking.forwardSpeed * braking.yawRate;
    expect(latBraking).toBeLessThan(latCoast * 0.5);
    // 減速と曲がりを合わせた加速度は、タイヤの限界（ブレーキの減速度）をあまり超えない
    expect(Math.hypot(latBraking, P.brakeDecel)).toBeLessThan(P.brakeDecel * 1.1);
  });

  it('keeps full cornering grip at low speed where the steering angle is not limited by grip', () => {
    const slow: VehicleState = { forwardSpeed: 3, lateralSpeed: 0, steerAngle: 0 };
    expect(run(slow, { steer: 1, brake: 1 }, 0.1).steerAngle).toBeCloseTo(run(slow, { steer: 1 }, 0.1).steerAngle, 2);
  });
});

describe('steering past the grip limit (understeer)', () => {
  const cruising: VehicleState = { forwardSpeed: 25, lateralSpeed: 0, steerAngle: 0 };
  const atLimit = steerLimitAt(25, P) / P.maxSteerAngle;

  it('lets the wheel turn past the grip limit at high speed, and the front tyres slide', () => {
    const s = run(cruising, { steer: 1 }, 1);
    expect(s.steerAngle).toBeGreaterThan(steerLimitAt(s.forwardSpeed, P) * 3);
    expect(s.understeer).toBe(1);
  });

  it('turns less and scrubs off more speed than steering just up to the limit', () => {
    const exact = run(cruising, { steer: atLimit }, 1);
    const over = run(cruising, { steer: 1 }, 1);
    expect(exact.understeer).toBeLessThan(0.05);
    // 横加速度 = 速さ × ヨーレート
    expect(over.forwardSpeed * over.yawRate).toBeLessThan(exact.forwardSpeed * exact.yawRate * 0.9);
    expect(over.forwardSpeed).toBeLessThan(exact.forwardSpeed - 1);
  });

  it('never turns harder than the grip allows however much the wheel is turned', () => {
    for (const steer of [0.2, 0.5, 1]) {
      const s = run(cruising, { steer }, 1);
      expect(s.forwardSpeed * s.yawRate).toBeLessThanOrEqual(lateralAccelAt(s.forwardSpeed, P) + 1e-6);
    }
  });

  it('does not slide at low speed even at full lock', () => {
    expect(run({ ...REST, forwardSpeed: 3 }, { steer: 1 }, 1).understeer).toBe(0);
  });
});

describe('steering feel', () => {
  it('turns the wheel more gently at high speed', () => {
    const slow = stepVehicle({ ...REST, forwardSpeed: 3 }, { ...NEUTRAL_INPUT, steer: 1 }, P, DT);
    const fast = stepVehicle({ ...REST, forwardSpeed: 28 }, { ...NEUTRAL_INPUT, steer: 1 }, P, DT);
    expect(fast.steerAngle).toBeLessThan(slow.steerAngle);
    expect(fast.steerAngle).toBeGreaterThan(0);
  });
});

describe('top speeds of the cars', () => {
  const top = (id: string) => topSpeedOf(VEHICLE_PRESETS.find((v) => v.id === id)!.params) * 3.6;

  it('settles at the top speed with the throttle held on a flat straight', () => {
    for (const v of VEHICLE_PRESETS) {
      let s = { ...REST, yawRate: 0 };
      for (let i = 0; i < 120 / DT; i++) s = stepVehicle(s, { ...NEUTRAL_INPUT, throttle: 1 }, v.params, DT);
      expect(s.forwardSpeed).toBeCloseTo(topSpeedOf(v.params), 0);
    }
  });

  it('matches the speeds estimated from the anime', () => {
    expect(top('ae86')).toBeCloseTo(210, 0);
    expect(top('fd3s')).toBeCloseTo(260, 0);
    expect(top('r34')).toBeCloseTo(285, 0);
    // 非力な AE85 と軽自動車より、AE86 やシビックは速く、GT-R がいちばん速い
    expect(top('ae85')).toBeLessThan(top('ae86'));
    expect(top('kei')).toBeLessThan(top('ae85'));
    expect(top('ae86')).toBeLessThan(top('eg6'));
    expect(top('gtr')).toBeLessThan(top('r34'));
    expect(Math.max(...VEHICLE_PRESETS.map((v) => top(v.id)))).toBeCloseTo(top('r34'), 5);
  });
});

describe('acceleration of the cars', () => {
  const preset = (id: string) => VEHICLE_PRESETS.find((v) => v.id === id)!.params;

  it('takes about as long from 0 to 100 km/h as the real cars', () => {
    // 実車の計測（AE86 約8.5秒、FD3S 約5.2秒、R34 約4.9秒、軽自動車 約14秒）に近い
    expect(accelTimeOf(preset('ae86'))).toBeGreaterThan(7);
    expect(accelTimeOf(preset('ae86'))).toBeLessThan(9);
    expect(accelTimeOf(preset('fd3s'))).toBeGreaterThan(4.5);
    expect(accelTimeOf(preset('fd3s'))).toBeLessThan(6);
    for (const v of VEHICLE_PRESETS) {
      expect(accelTimeOf(v.params)).toBeGreaterThan(4.5);
      expect(accelTimeOf(v.params)).toBeLessThan(15);
    }
    expect(accelTimeOf(preset('r34'))).toBeLessThan(accelTimeOf(preset('ae86')));
    expect(accelTimeOf(preset('kei'))).toBeGreaterThan(accelTimeOf(preset('ae85')));
  });

  it('pulls weaker at high speed than at low speed', () => {
    const fd = preset('fd3s');
    expect(driveAccelAt(5, fd)).toBe(fd.engineAccel);
    expect(driveAccelAt(40, fd)).toBeLessThan(driveAccelAt(20, fd) * 0.6);
    // 低速でもタイヤのグリップを超える加速（1G 近く）はしない
    for (const v of VEHICLE_PRESETS) expect(driveAccelAt(0, v.params)).toBeLessThanOrEqual(9.81);
  });
});

describe('braking and cornering of the cars', () => {
  it('stops and corners at about 1 G like real cars on sports tyres', () => {
    for (const v of VEHICLE_PRESETS) {
      expect(v.params.brakeDecel).toBeGreaterThan(0.7 * 9.81);
      expect(v.params.brakeDecel).toBeLessThan(1.2 * 9.81);
      expect(lateralAccelAt(30, v.params)).toBeGreaterThan(0.65 * 9.81);
      expect(lateralAccelAt(30, v.params)).toBeLessThan(1.15 * 9.81);
    }
    // AE86 は 100km/h から 40m 前後で止まる
    const ae86 = VEHICLE_PRESETS.find((c) => c.id === 'ae86')!.params;
    let s = { ...REST, forwardSpeed: 100 / 3.6, yawRate: 0 };
    let d = 0;
    while (s.forwardSpeed > 0) {
      s = stepVehicle(s, { ...NEUTRAL_INPUT, brake: 1 }, ae86, DT);
      d += s.forwardSpeed * DT;
    }
    expect(d).toBeGreaterThan(30);
    expect(d).toBeLessThan(45);
  });
});

describe('heavy cars in tight and fast corners', () => {
  const lat = (id: string, kmh: number) => lateralAccelAt(kmh / 3.6, VEHICLE_PRESETS.find((c) => c.id === id)!.params);

  it('lets the light FD3S and Evo IV out-corner the heavy R34 at low speed, but not at high speed', () => {
    for (const light of ['fd3s', 'evo']) {
      expect(lat(light, 50)).toBeGreaterThan(lat('r34', 50));
      expect(lat(light, 160)).toBeLessThan(lat('r34', 160));
    }
  });

  it('lets the Evo III out-corner the heavy R32 at low speed, but not at high speed', () => {
    expect(lat('evo3', 50)).toBeGreaterThan(lat('gtr', 50));
    expect(lat('evo3', 160)).toBeLessThan(lat('gtr', 160));
  });
});

describe('keySteerLimit（キーボードのハンドルを速さに合わせる）', () => {
  const p = DEFAULT_VEHICLE_PARAMS;
  it('低速では目いっぱい切れる', () => {
    expect(keySteerLimit(3, p)).toBe(1);
  });
  it('高速では限界の少し先まで', () => {
    const v = 25;
    expect(keySteerLimit(v, p) * p.maxSteerAngle).toBeCloseTo(KEY_STEER_OVER * steerLimitAt(v, p));
    expect(keySteerLimit(v, p)).toBeLessThan(0.1);
  });
  it('ブレーキ中は曲がれる分が減るので、切れる量も減る', () => {
    expect(keySteerLimit(20, p, 1)).toBeLessThan(keySteerLimit(20, p));
  });
  it('押し続けても、アンダーステアはほんの少し', () => {
    let state = { forwardSpeed: 25, lateralSpeed: 0, steerAngle: 0 };
    let understeer = 0;
    for (let i = 0; i < 120; i++) {
      const r = stepVehicle(state, { throttle: 1, brake: 0, steer: keySteerLimit(state.forwardSpeed, p) }, p, 1 / 60);
      state = { forwardSpeed: r.forwardSpeed, lateralSpeed: r.lateralSpeed, steerAngle: r.steerAngle };
      understeer = Math.max(understeer, r.understeer);
    }
    expect(understeer).toBeGreaterThan(0);
    expect(understeer).toBeLessThan(0.05);
  });
});
