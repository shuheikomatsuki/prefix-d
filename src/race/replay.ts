import { GHOST_INTERVAL, type GhostData, type InputData, type Telemetry, telemetryAt } from './ghost';

/**
 * リプレイ（走りを見返す）。1台ごとにゴースト（位置と向き）と操作（ハンドル・アクセル・ブレーキ・速さ）の記録を持ち、
 * 時刻を指定して取り出す。描画には依存しない。
 */

/** リプレイの1台 */
export interface ReplayTrack {
  name: string;
  /** 車の id（VEHICLE_PRESETS） */
  car: string;
  color: number;
  /** 自分の車か */
  isPlayer: boolean;
  /** ゴースト（自己ベストなど）として半透明で出すか */
  ghostly?: boolean;
  ghost: GhostData;
  /** 操作の記録（無いか、数が合わなければ空。そのときは位置から速さだけ求める） */
  inputs: InputData;
}

/** 時刻の目印（周回・ゴールなど。シークバーに出す） */
export interface ReplayMark {
  time: number;
  label: string;
}

export interface Replay {
  /** コース（MapDefinition.id） */
  course: string;
  /** 画面に出す題名（「タイムアタック 1:23.45」など） */
  title: string;
  tracks: ReplayTrack[];
  marks: ReplayMark[];
}

/** ある時刻の1台の様子 */
export interface ReplayFrame extends Telemetry {
  x: number;
  z: number;
  yaw: number;
  /** 操作の記録があるか（無ければハンドル・アクセル・ブレーキは 0） */
  hasInputs: boolean;
  /** 記録の終わりを過ぎて止まっているか */
  ended: boolean;
}

/** 記録した点の数 */
export function frameCount(track: ReplayTrack): number {
  return Math.floor(track.ghost.length / 3);
}

/** 1台の記録の長さ [s] */
export function trackDuration(track: ReplayTrack): number {
  return Math.max(0, frameCount(track) - 1) * GHOST_INTERVAL;
}

/** リプレイ全体の長さ [s]（いちばん長く記録した車に合わせる） */
export function replayDuration(replay: Replay): number {
  return Math.max(0, ...replay.tracks.map(trackDuration));
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * 1台の、スタートから time 秒の様子。記録の前後は最初・最後の点で止まっている。
 * 記録が無ければ null
 */
export function frameAt(track: ReplayTrack, time: number): ReplayFrame | null {
  const n = frameCount(track);
  if (n === 0) return null;
  const g = track.ghost;
  const f = Math.min(Math.max(0, time / GHOST_INTERVAL), n - 1);
  const i = Math.min(Math.floor(f), Math.max(0, n - 2));
  const j = Math.min(i + 1, n - 1);
  const t = n === 1 ? 0 : f - i;
  const a = i * 3;
  const b = j * 3;
  const ended = time > (n - 1) * GHOST_INTERVAL;
  const pose = {
    x: g[a] + (g[b] - g[a]) * t,
    z: g[a + 1] + (g[b + 1] - g[a + 1]) * t,
    yaw: g[a + 2] + wrapAngle(g[b + 2] - g[a + 2]) * t,
  };
  const ta = telemetryAt(track.inputs, i);
  const tb = telemetryAt(track.inputs, j);
  if (ta && tb) {
    const mix = (k: keyof Telemetry) => ta[k] + (tb[k] - ta[k]) * t;
    return {
      ...pose,
      steer: mix('steer'),
      throttle: mix('throttle'),
      brake: mix('brake'),
      speed: ended ? 0 : mix('speed'),
      understeer: mix('understeer'),
      hasInputs: true,
      ended,
    };
  }
  // 操作の記録が無い（古い記録）: 速さだけ、前後の点の距離から求める
  const speed = n > 1 && !ended ? Math.hypot(g[b] - g[a], g[b + 1] - g[a + 1]) / GHOST_INTERVAL : 0;
  return { ...pose, steer: 0, throttle: 0, brake: 0, speed, understeer: 0, hasInputs: false, ended };
}

/** 再生の速さの段階 */
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** リプレイの再生位置（一時停止・早送り・スロー・シーク） */
export class ReplayClock {
  time = 0;
  playing = true;
  private speedIndex = PLAYBACK_SPEEDS.indexOf(1);

  constructor(readonly duration: number) {}

  get speed(): number {
    return PLAYBACK_SPEEDS[this.speedIndex];
  }

  /** 描画のたびに呼ぶ。最後まで進んだら止まる。進んだ時間 [s]（巻き戻しや停止中は 0）を返す */
  update(frameDt: number): number {
    if (!this.playing) return 0;
    const before = this.time;
    this.time = Math.min(this.duration, this.time + frameDt * this.speed);
    if (this.time >= this.duration) this.playing = false;
    return this.time - before;
  }

  /** 再生と一時停止を切り替える。最後で再生したら最初から */
  toggle(): void {
    if (!this.playing && this.time >= this.duration) this.time = 0;
    this.playing = !this.playing;
  }

  seek(time: number): void {
    this.time = Math.min(this.duration, Math.max(0, time));
  }

  /** 再生の速さを1段変える（+1 で速く、-1 で遅く） */
  changeSpeed(step: number): void {
    this.speedIndex = Math.min(PLAYBACK_SPEEDS.length - 1, Math.max(0, this.speedIndex + step));
  }

  setSpeed(speed: number): void {
    const i = PLAYBACK_SPEEDS.indexOf(speed as (typeof PLAYBACK_SPEEDS)[number]);
    if (i >= 0) this.speedIndex = i;
  }
}

/** 周回のタイムから、各周の終わりの時刻の目印を作る（最後はゴール） */
export function lapMarks(laps: readonly number[]): ReplayMark[] {
  let t = 0;
  return laps.map((lap, i) => {
    t += lap;
    return { time: t, label: i === laps.length - 1 ? 'ゴール' : `${i + 1}周` };
  });
}

/** ハンドルの向きの説明（「左 35%」。ほぼまっすぐなら「まっすぐ」） */
export function steerLabel(steer: number): string {
  const pct = Math.round(Math.abs(steer) * 100);
  if (pct < 2) return 'まっすぐ';
  return `${steer > 0 ? '左' : '右'} ${pct}%`;
}

/** 記録が長すぎないよう、これより長く記録しない [s] */
export const MAX_REPLAY_SECONDS = 15 * 60;
