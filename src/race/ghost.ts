/**
 * ゴースト（過去の走りの再生）。一定間隔で車の位置と向きを記録し、時刻を指定して取り出す。
 */

/** 記録する間隔 [s] */
export const GHOST_INTERVAL = 0.1;

export interface GhostPose {
  x: number;
  z: number;
  yaw: number;
}

/** [x, z, yaw] を並べたもの（保存しやすいよう平らな配列） */
export type GhostData = number[];

/**
 * 運転の操作と様子（リプレイで見せる）。ゴーストと同じ時刻に1組ずつ、
 * [ハンドル, アクセル, ブレーキ, 速さ, アンダーステア] を整数にして並べる（INPUT_STRIDE 個で1組）
 */
export type InputData = number[];
export const INPUT_STRIDE = 5;

export interface Telemetry {
  /** タイヤの切れ角を、いっぱいに切ったときを ±1 として（車と同じく左が +） */
  steer: number;
  /** 0〜1 */
  throttle: number;
  /** 0〜1 */
  brake: number;
  /** 前向きの速さ [m/s]（バックは負） */
  speed: number;
  /** 0〜1（ハンドルを限界より切りすぎて前のタイヤが滑っている度合い） */
  understeer: number;
}

/** 記録するときの整数の倍率（ハンドル・アクセル・ブレーキ・アンダーステアは %、速さは 0.1 m/s） */
const SCALE = [100, 100, 100, 10, 100] as const;

export function encodeTelemetry(t: Telemetry): number[] {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));
  return [clamp(t.steer, -1, 1), clamp(t.throttle, 0, 1), clamp(t.brake, 0, 1), clamp(t.speed, -200, 200), clamp(t.understeer, 0, 1)].map((v, i) =>
    Math.round(v * SCALE[i]),
  );
}

/** i 番目の組を読む（無ければ null） */
export function telemetryAt(inputs: InputData, i: number): Telemetry | null {
  const a = i * INPUT_STRIDE;
  if (i < 0 || a + INPUT_STRIDE > inputs.length) return null;
  return {
    steer: inputs[a] / SCALE[0],
    throttle: inputs[a + 1] / SCALE[1],
    brake: inputs[a + 2] / SCALE[2],
    speed: inputs[a + 3] / SCALE[3],
    understeer: inputs[a + 4] / SCALE[4],
  };
}

/** 操作の記録が、ゴースト（frames 個の数値）と同じ数の組だけあるか */
export function inputsMatch(inputs: readonly unknown[], ghostValues: number): boolean {
  return inputs.length === (ghostValues / 3) * INPUT_STRIDE;
}

export class GhostRecorder {
  private readonly data: GhostData = [];
  private readonly input: InputData = [];
  private nextTime = 0;

  /** time はスタートからの時間 [s]。記録する時刻になっていれば記録する（操作が無ければ 0 で埋める） */
  sample(time: number, pose: GhostPose, telemetry?: Telemetry): void {
    if (time < this.nextTime) return;
    const r = (v: number, k: number) => Math.round(v * k) / k;
    this.data.push(r(pose.x, 100), r(pose.z, 100), r(pose.yaw, 1000));
    this.input.push(...(telemetry ? encodeTelemetry(telemetry) : new Array<number>(INPUT_STRIDE).fill(0)));
    this.nextTime += GHOST_INTERVAL;
  }

  get frames(): GhostData {
    return this.data;
  }

  get inputs(): InputData {
    return this.input;
  }
}

/** 記録した走りの、スタートから time 秒の位置（記録の範囲外なら null） */
export function ghostPoseAt(data: GhostData, time: number): GhostPose | null {
  const count = data.length / 3;
  if (count === 0 || time < 0) return null;
  const f = time / GHOST_INTERVAL;
  const i = Math.floor(f);
  if (i >= count - 1) return null;
  const t = f - i;
  const a = i * 3;
  const b = a + 3;
  let dyaw = data[b + 2] - data[a + 2];
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return {
    x: data[a] + (data[b] - data[a]) * t,
    z: data[a + 1] + (data[b + 1] - data[a + 1]) * t,
    yaw: data[a + 2] + dyaw * t,
  };
}
