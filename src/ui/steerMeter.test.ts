import { describe, expect, it } from 'vitest';
import { meterScale, steerMeterView } from './steerMeter';

describe('ハンドルのメーター', () => {
  it('小さな角度を広げて見せる（平方根の目盛り）', () => {
    expect(meterScale(0)).toBe(0);
    expect(meterScale(0.04)).toBeCloseTo(0.2);
    expect(meterScale(-1)).toBe(-1);
    expect(meterScale(2)).toBe(1);
  });

  it('限界の内側か、超えて切っているか', () => {
    const inside = steerMeterView(0.03, 0.04, 0.6, 0);
    expect(inside.over).toBe(false);
    expect(inside.pos).toBeGreaterThan(0);
    expect(inside.pos).toBeLessThan(inside.limit);
    expect(inside.label).toBe('左 5%');
    const over = steerMeterView(-0.2, 0.04, 0.6, 0.8);
    expect(over.over).toBe(true);
    expect(over.pos).toBeLessThan(0);
    expect(over.label).toBe('右 33%');
  });

  it('限界をわずかに超えただけでは、アンダーとして出さない', () => {
    expect(steerMeterView(0.05, 0.04, 0.6, 0.02).over).toBe(false);
  });

  it('低速では限界が最大舵角いっぱい', () => {
    expect(steerMeterView(0.6, 0.6, 0.6, 0)).toMatchObject({ limit: 1, over: false });
  });
});
