import { VEHICLE_PRESETS, type VehiclePreset, accelTimeOf, topSpeedOf } from '../sim/vehicle';

/** メニューに出す車の性能の 1 項目（value は選べる車の中での 0..1） */
export interface CarStat {
  label: string;
  value: number;
  /** 数字で出せる項目は、その値 */
  text?: string;
}

const METRICS: readonly { label: string; of: (v: VehiclePreset) => number; text?: (v: VehiclePreset) => string }[] = [
  { label: '最高速', of: (v) => topSpeedOf(v.params), text: (v) => `${Math.round(topSpeedOf(v.params) * 3.6)} km/h` },
  // 0-100km/h の秒数。短いほど棒が長い
  { label: '加速', of: (v) => 1 / accelTimeOf(v.params), text: (v) => `${accelTimeOf(v.params).toFixed(1)} 秒` },
  { label: 'コーナー', of: (v) => v.params.maxLateralAccel },
  { label: 'グリップ', of: (v) => v.params.lateralGrip },
  { label: 'ブレーキ', of: (v) => v.params.brakeDecel },
];

/** いちばん弱い車でも、棒が少しは見えるようにする */
const FLOOR = 0.12;

/** 車の性能を、選べる車の中で比べた 0..1 の値にする */
export function carStats(car: VehiclePreset, presets: readonly VehiclePreset[] = VEHICLE_PRESETS): CarStat[] {
  return METRICS.map((m) => {
    const values = presets.map(m.of);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const t = max > min ? (m.of(car) - min) / (max - min) : 1;
    return { label: m.label, value: FLOOR + (1 - FLOOR) * t, ...(m.text ? { text: m.text(car) } : {}) };
  });
}

/** 駆動方式（説明の先頭の「FR・」など。書いていなければ null） */
export function driveOf(car: VehiclePreset): string | null {
  const m = /^(FR|FF|4WD|MR|RR)・/.exec(car.description);
  return m ? m[1] : null;
}
