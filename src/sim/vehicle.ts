/**
 * 車両の運動モデル（物理エンジン・描画に依存しない純粋なロジック）。
 *
 * 車体ローカル座標での速度（前後・左右）と舵角を受け取り、
 * 1ステップ後の速度・舵角・ヨーレートを返す。
 * 衝突は物理エンジン側が解決し、その結果の速度が次のステップの入力になる。
 *
 * 座標系: 前方 = +Z、左 = +X、上 = +Y。steer > 0 で左に曲がる。
 */

/** 手動運転・AI・ネットワークで共通の運転入力 */
export interface DriverInput {
  /** アクセル 0..1 */
  throttle: number;
  /** ブレーキ 0..1（停止付近で踏み続けると後退） */
  brake: number;
  /** ハンドル -1（右）..1（左） */
  steer: number;
}

export const NEUTRAL_INPUT: Readonly<DriverInput> = { throttle: 0, brake: 0, steer: 0 };

export interface VehicleParams {
  /** 前進の最高速度 [m/s] */
  maxForwardSpeed: number;
  /** 後退の最高速度 [m/s] */
  maxReverseSpeed: number;
  /** 低速での加速度の上限 [m/s^2]（1速でタイヤが空転しない範囲の加速。実車でおよそ 0.35〜0.9G） */
  engineAccel: number;
  /** 車重あたりの出力 [W/kg]（駆動輪に届く分）。速さ v での加速度は enginePower / v で、速いほど伸びなくなる */
  enginePower: number;
  /** 後退時の加速度 [m/s^2] */
  reverseAccel: number;
  /** ブレーキの減速度 [m/s^2]（実車でおよそ 0.75〜1.15G） */
  brakeDecel: number;
  /** アクセルを離したときの減速度 [m/s^2] */
  coastDecel: number;
  /** 空気抵抗係数（減速度 = dragCoef * v^2） */
  dragCoef: number;
  /** ホイールベース [m] */
  wheelBase: number;
  /** 最大舵角 [rad] */
  maxSteerAngle: number;
  /** ハンドルを切る速さ [rad/s] */
  steerRate: number;
  /** ハンドルが中央に戻る速さ [rad/s] */
  steerReturnRate: number;
  /** 旋回時の横加速度の上限 [m/s^2]（高速ほど舵角が自動で絞られる。実車でおよそ 0.7〜1.05G） */
  maxLateralAccel: number;
  /** 横滑りの減衰率 [1/s]（大きいほどグリップが強い） */
  lateralGrip: number;
}

export const DEFAULT_VEHICLE_PARAMS: Readonly<VehicleParams> = {
  maxForwardSpeed: 30,
  maxReverseSpeed: 7,
  engineAccel: 5,
  enginePower: 55,
  reverseAccel: 4,
  brakeDecel: 8.2,
  coastDecel: 0.8,
  dragCoef: 0.0015,
  wheelBase: 2.6,
  maxSteerAngle: 0.6,
  steerRate: 2.2,
  steerReturnRate: 3.5,
  maxLateralAccel: 7.8,
  lateralGrip: 8,
};

export interface VehiclePreset {
  /** 変わらない id（ランキングの区別に使う）。表示名 label は変えてもよい */
  id: string;
  label: string;
  /** メニューに出す短い説明 */
  description: string;
  params: Readonly<VehicleParams>;
}

/** 最高速度の余裕: maxForwardSpeed をこの割合だけ最高速度より高くし、空気抵抗と釣り合う速さを最高速度にする */
const TOP_SPEED_HEADROOM = 1.1;
/** maxForwardSpeed の手前この速さ [m/s] で、エンジンの加速をなくしていく */
const TOP_FADE = 2;

/**
 * アクセル全開での、エンジンによる加速度 [m/s^2]（抵抗を引く前）。
 * 低速ではタイヤのグリップ（engineAccel）、速くなると出力（enginePower / v）で決まる
 */
export function driveAccelAt(speed: number, p: Readonly<VehicleParams>): number {
  const v = Math.max(0, speed);
  const fade = Math.min(1, Math.max(0, (p.maxForwardSpeed - v) / TOP_FADE));
  return Math.min(p.engineAccel, p.enginePower / Math.max(v, 0.1)) * fade;
}

/** アクセルを踏み続けて平らな直線で落ち着く速さ [m/s]（エンジンの加速と空気抵抗が釣り合う速さ） */
export function topSpeedOf(p: Readonly<VehicleParams>): number {
  let lo = 0;
  let hi = p.maxForwardSpeed;
  for (let i = 0; i < 60; i++) {
    const v = (lo + hi) / 2;
    if (driveAccelAt(v, p) > p.dragCoef * v * v) lo = v;
    else hi = v;
  }
  return lo;
}

/** 平らな直線で止まった状態からアクセル全開にして、速さ kmh [km/h] に届くまでの秒数（届かなければ Infinity） */
export function accelTimeOf(p: Readonly<VehicleParams>, kmh = 100): number {
  const dt = 1 / 120;
  let s: VehicleState = { forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0 };
  for (let t = dt; t < 120; t += dt) {
    s = stepVehicle(s, { throttle: 1, brake: 0, steer: 0 }, p, dt);
    if (s.forwardSpeed * 3.6 >= kmh) return t;
  }
  return Infinity;
}

/** 最高速度 topKmh [km/h] の車の性能（空気抵抗の係数を最高速度から決める） */
function car(topKmh: number, p: Partial<VehicleParams>): VehicleParams {
  const params = { ...DEFAULT_VEHICLE_PARAMS, ...p };
  const v = topKmh / 3.6;
  const withTop = { ...params, maxForwardSpeed: v * TOP_SPEED_HEADROOM };
  return { ...withTop, dragCoef: driveAccelAt(v, withTop) / (v * v) };
}

/**
 * 選べる車（P キーで切り替え）。最高速度 [km/h] は、イニシャルDのアニメの場面（メーターの読み・直線での伸び・
 * 車どうしの差）と、それぞれの車のチューニングから見積もった値。
 * 加速（engineAccel・enginePower）は、実車の 0-100km/h の加速タイム（雑誌の計測やカタログの出力・車重）に、
 * 作中のチューニングを少し足した値に合わせた（コメントの秒数）。
 * ブレーキ・横G は、スポーツタイヤの実車の 1G 前後（100km/h から 40m 前後で止まる）を上限に、車ごとの差をつけた
 */
export const VEHICLE_PRESETS: readonly VehiclePreset[] = [
  {
    id: 'standard',
    label: '普通車',
    description: '扱いやすいふつうの車',
    // 0-100km/h 11秒
    params: car(180, { engineAccel: 4, enginePower: 43 }),
  },
  {
    id: 'kei',
    label: '軽自動車',
    description: '遅いけれど小回りがきく',
    // 0-100km/h 14秒
    params: car(140, { engineAccel: 3.5, enginePower: 37, brakeDecel: 7.3, wheelBase: 2.4, maxLateralAccel: 6.9 }),
  },
  {
    id: 'cappuccino',
    label: 'カプチーノ',
    description: 'FR・軽のオープンカー。とても軽く、小さく鋭く曲がる',
    params: car(170, {
      engineAccel: 4.5,
      enginePower: 48, // 0-100km/h 10秒
      brakeDecel: 11.3,
      wheelBase: 2.06,
      maxSteerAngle: 0.64,
      steerRate: 3.1,
      steerReturnRate: 4,
      maxLateralAccel: 10.3,
      lateralGrip: 10,
    }),
  },
  {
    id: 'ae85',
    label: 'AE85',
    description: 'FR・AE86の兄弟車。軽いが非力で、坂と直線は苦手',
    params: car(160, {
      engineAccel: 4,
      enginePower: 42, // 0-100km/h 11.5秒
      brakeDecel: 10.5,
      wheelBase: 2.4,
      maxSteerAngle: 0.62,
      steerRate: 2.8,
      steerReturnRate: 3.8,
      maxLateralAccel: 9.6,
      lateralGrip: 9,
    }),
  },
  {
    id: 'ae86',
    label: 'AE86',
    description: 'FR・軽い。直線は遅いがコーナーは速い',
    params: car(210, {
      engineAccel: 5,
      enginePower: 59, // 0-100km/h 8秒
      brakeDecel: 11.3,
      wheelBase: 2.4,
      maxSteerAngle: 0.62,
      steerRate: 2.9,
      steerReturnRate: 3.8,
      maxLateralAccel: 10.5,
      lateralGrip: 9.5,
    }),
  },
  {
    id: 'eg6',
    label: 'シビック (EG6)',
    description: 'FF・軽い。パワーは控えめだが曲がりやすい',
    params: car(215, {
      engineAccel: 5.5,
      enginePower: 69, // 0-100km/h 7秒
      // タイヤが EK9 よりさらに細い（195・14インチ）
      brakeDecel: 10.5,
      wheelBase: 2.45,
      maxSteerAngle: 0.62,
      steerRate: 2.9,
      steerReturnRate: 3.8,
      maxLateralAccel: 9.2,
      lateralGrip: 10.5,
    }),
  },
  {
    id: 'ek9',
    label: 'シビック (EK9)',
    description: 'FF・高回転のVTEC。軽くて立ち上がりが鋭い',
    params: car(225, {
      engineAccel: 6,
      enginePower: 73, // 0-100km/h 6.5秒
      // タイヤが細い（195・15インチ）ので、ブレーキと横G は上位の車より控えめ
      brakeDecel: 10.7,
      wheelBase: 2.5,
      maxSteerAngle: 0.62,
      steerRate: 2.9,
      steerReturnRate: 3.8,
      maxLateralAccel: 9.4,
      lateralGrip: 11,
    }),
  },
  {
    id: 's13',
    label: 'シルビア (S13)',
    description: 'FR・ターボ。パワーはそこそこで、お尻を流しやすい',
    params: car(220, {
      engineAccel: 6,
      enginePower: 69, // 0-100km/h 6.8秒
      brakeDecel: 10.5,
      wheelBase: 2.475,
      steerRate: 2.7,
      maxLateralAccel: 9.2,
      lateralGrip: 8.5,
    }),
  },
  {
    id: 's14',
    label: 'シルビア (S14)',
    description: 'FR・ターボ。S13よりパワーがあり、少し大きく安定',
    params: car(235, {
      engineAccel: 6.5,
      enginePower: 73, // 0-100km/h 6.3秒
      brakeDecel: 10.7,
      wheelBase: 2.525,
      steerRate: 2.6,
      maxLateralAccel: 9.4,
      lateralGrip: 9,
    }),
  },
  {
    id: 'fd3s',
    label: 'RX-7 (FD3S)',
    description: 'FR・ロータリーターボ。軽くて前後のバランスがよく、速くてよく曲がる',
    params: car(260, {
      engineAccel: 7.5,
      enginePower: 90, // 0-100km/h 5.2秒
      brakeDecel: 10.9,
      wheelBase: 2.43,
      steerRate: 2.8,
      maxLateralAccel: 9.8,
      lateralGrip: 10,
    }),
  },
  {
    id: 'evo3',
    label: 'ランエボIII',
    description: '4WD・ターボ。大きなウイング。IVより少し非力',
    params: car(240, {
      engineAccel: 8.5,
      enginePower: 80, // 0-100km/h 5.5秒
      brakeDecel: 10.9,
      wheelBase: 2.51,
      steerRate: 2.5,
      maxLateralAccel: 9.2,
      lateralGrip: 11,
    }),
  },
  {
    id: 'evo',
    label: 'ランエボIV',
    description: '4WD・ターボ。立ち上がりの加速とグリップが強い',
    params: car(245, {
      engineAccel: 9,
      enginePower: 89, // 0-100km/h 5秒
      brakeDecel: 10.9,
      wheelBase: 2.5,
      steerRate: 2.5,
      maxLateralAccel: 9.4,
      lateralGrip: 11.5,
    }),
  },
  {
    id: 'gtr',
    label: 'GT-R (R32)',
    description: '4WD・ツインターボ。最高速がいちばん高いが重い',
    params: car(265, {
      engineAccel: 9,
      enginePower: 89, // 0-100km/h 5秒
      brakeDecel: 10,
      wheelBase: 2.62,
      steerRate: 2.3,
      maxLateralAccel: 9.2,
      lateralGrip: 11,
    }),
  },
  {
    id: 'r34',
    label: 'GT-R (R34)',
    description: '4WD・ツインターボ。R32より速く、高速コーナーも安定',
    params: car(285, {
      engineAccel: 9,
      enginePower: 93, // 0-100km/h 4.8秒
      // ブレンボのブレーキと太いタイヤ（245）で、重いがブレーキ・横G は FD3S と並ぶ
      brakeDecel: 10.9,
      wheelBase: 2.66,
      steerRate: 2.3,
      maxLateralAccel: 9.9,
      lateralGrip: 11.5,
    }),
  },
];

export interface VehicleState {
  /** 前後方向の速度 [m/s]（前進が正） */
  forwardSpeed: number;
  /** 左右方向の速度 [m/s]（左が正） */
  lateralSpeed: number;
  /** 現在の舵角 [rad]（左が正） */
  steerAngle: number;
}

export interface VehicleStepResult extends VehicleState {
  /** ヨーレート [rad/s]（上から見て反時計回り＝左旋回が正） */
  yawRate: number;
}

/** この速度未満では「止まっている」とみなし、ブレーキ入力を後退として扱う */
const STOP_THRESHOLD = 0.5;

/** ダウンフォース: この速さ [m/s] から横加速度の上限が増え始め、DOWNFORCE_FULL で最大になる */
const DOWNFORCE_FROM = 15;
const DOWNFORCE_FULL = 40;
/** 高速で増える横加速度の上限の割合（市販車の空力はわずかなので小さく） */
const DOWNFORCE_GAIN = 0.08;

/** 速さ speed [m/s] での横加速度の上限。速いほど車が路面に押し付けられ、少し大きくなる */
export function lateralAccelAt(speed: number, p: VehicleParams): number {
  const t = Math.min(1, Math.max(0, (Math.abs(speed) - DOWNFORCE_FROM) / (DOWNFORCE_FULL - DOWNFORCE_FROM)));
  return p.maxLateralAccel * (1 + DOWNFORCE_GAIN * t);
}

/** 速度に応じた舵角の上限。低速では最大舵角、高速では横加速度が上限を超えないよう絞る */
export function steerLimitAt(speed: number, p: VehicleParams): number {
  const v2 = speed * speed;
  if (v2 < 1e-6) return p.maxSteerAngle;
  return Math.min(p.maxSteerAngle, Math.atan((lateralAccelAt(speed, p) * p.wheelBase) / v2));
}

function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** 速度を 0 に向けて amount だけ減らす（0 を超えて反転させない） */
function decelerate(speed: number, amount: number): number {
  if (speed > 0) return Math.max(0, speed - amount);
  return Math.min(0, speed + amount);
}

function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function stepVehicle(
  state: VehicleState,
  rawInput: DriverInput,
  p: VehicleParams,
  dt: number,
): VehicleStepResult {
  const throttle = clamp(rawInput.throttle, 0, 1);
  const brake = clamp(rawInput.brake, 0, 1);
  const steer = clamp(rawInput.steer, -1, 1);

  // --- 前後方向 ---
  let v = state.forwardSpeed;
  const movingForward = v > STOP_THRESHOLD;
  const movingBackward = v < -STOP_THRESHOLD;

  if (throttle > 0 && !movingBackward) {
    // 前進加速（速いほど弱まる）
    v += throttle * driveAccelAt(v, p) * dt;
  } else if (throttle > 0 && movingBackward) {
    // 後退中のアクセルはブレーキとして働く
    v = decelerate(v, throttle * p.brakeDecel * dt);
  }

  if (brake > 0 && !movingForward && throttle === 0) {
    // 停止中・後退中のブレーキは後退
    const headroom = Math.max(0, 1 + v / p.maxReverseSpeed);
    v -= brake * p.reverseAccel * headroom * dt;
  } else if (brake > 0 && movingForward) {
    v = decelerate(v, brake * p.brakeDecel * dt);
  }

  // 抵抗（転がり抵抗 + 空気抵抗）
  const resistance = (throttle === 0 && brake === 0 ? p.coastDecel : 0) + p.dragCoef * v * v;
  v = decelerate(v, resistance * dt);

  // --- ハンドル ---
  const limit = steerLimitAt(v, p);
  const targetSteer = steer * limit;
  // 高速では舵角の上限が小さいので、切る速さも合わせて落とす（キーボードでも急に曲がりすぎない）
  const rateScale = Math.max(0.5, limit / p.maxSteerAngle);
  const rate = (steer === 0 ? p.steerReturnRate : p.steerRate) * rateScale;
  let steerAngle = approach(state.steerAngle, targetSteer, rate * dt);
  steerAngle = clamp(steerAngle, -limit, limit);

  // --- 旋回（自転車モデル） ---
  const yawRate = (v * Math.tan(steerAngle)) / p.wheelBase;

  // --- 横滑り（タイヤのグリップで減衰） ---
  const lateralSpeed = state.lateralSpeed * Math.exp(-p.lateralGrip * dt);

  return { forwardSpeed: v, lateralSpeed, steerAngle, yawRate };
}
