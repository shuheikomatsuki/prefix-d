import type { Course } from './course';

/** カウントダウンの長さ [s]（3, 2, 1, スタート） */
export const COUNTDOWN_SECONDS = 3;
/** 一度に飛ばしてよいタイルの数。これより先へ飛んだら近道とみなして周回を進めない */
const MAX_SKIP = 3;
/**
 * ヘアピンの内側に近道があるコースで一度に飛ばしてよいタイルの数。近道で飛び越すのは
 * 入口のカーブ・直線・出口のカーブの3枚（と少しの余裕）
 */
const SHORTCUT_MAX_SKIP = 5;
/** 逆走とみなすまでの時間 [s] */
const WRONG_WAY_SECONDS = 1;

/** ready = スタートの合図（begin）を待っている */
export type RacePhase = 'ready' | 'countdown' | 'racing' | 'finished';

export type RaceEvent =
  /** カウントダウンの数字が変わった（0 でスタート） */
  | { type: 'count'; value: number }
  | { type: 'lap'; lap: number; time: number }
  | { type: 'finish'; total: number; laps: number[] }
  | { type: 'wrongWay'; on: boolean }
  /** コースから外れて近道をした（周回が進まない） */
  | { type: 'offCourse'; on: boolean };

/**
 * タイムアタックの進行（描画に依存しない）。
 * （合図を待つ →）カウントダウン → 規定周回を走る → ゴール。コースのタイルを順番にたどった場合だけ周回を数える。
 */
export class TimeAttack {
  phase: RacePhase = 'countdown';
  /** スタート（カウントダウン終了）からの時間 [s] */
  time = -COUNTDOWN_SECONDS;
  /** 走り終えた周のタイム */
  readonly laps: number[] = [];
  /** 最後にたどったタイルの番号 */
  private progress: number;
  /** スタートラインを最初に越えたか（スタート位置はラインの手前なので、最初の通過は周回に数えない） */
  private started = false;
  private lapStart = 0;
  private wrongWayTime = 0;
  private wrongWay = false;
  private offCourse = false;
  private events: RaceEvent[] = [];
  private begun = false;
  private readonly maxSkip: number;
  /** 直前にいたコース上の距離（立体交差や往復のコースで、どちらの道にいるかを取り違えないため）。最初はスタートライン */
  private hint: number | null = 0;
  /** 最後に正しくコースを走っていた所のコース上の距離（近道をしたとき、ここへ戻す） */
  private lastGoodS: number | null = null;

  constructor(
    readonly course: Course,
    readonly totalLaps: number,
    /** true なら、begin() を呼ぶまでカウントダウンを始めない */
    waitForStart = false,
  ) {
    // 周回コースはスタートラインの手前（最後のタイル）から、一本道のコースはコースの手前（-1）から
    this.progress = course.closed ? course.checkpoints - 1 : -1;
    this.maxSkip = course.map.def.shortcuts ? SHORTCUT_MAX_SKIP : MAX_SKIP;
    if (waitForStart) this.phase = 'ready';
    else this.begin();
  }

  /** カウントダウンを始める（合図を待っているときだけ） */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    this.phase = 'countdown';
    this.events.push({ type: 'count', value: COUNTDOWN_SECONDS });
  }

  /** いま走っている周（1 から） */
  get lap(): number {
    return Math.min(this.laps.length + 1, this.totalLaps);
  }

  /** いまの周のタイム */
  get lapTime(): number {
    return Math.max(0, this.time - this.lapStart);
  }

  get isWrongWay(): boolean {
    return this.wrongWay;
  }

  /** コースを外れて近道をしている（コースに戻されるのを待っている）か */
  get isOffCourse(): boolean {
    return this.offCourse;
  }

  /**
   * 順位を決めるための、スタートラインからコースに沿って進んだ距離 [m]（周回分を含む）。
   * スタート前（ラインの手前）は負になる
   */
  distance(x: number, z: number): number {
    const s = this.course.project(x, z, { s: this.hint }).s;
    if (!this.course.closed) return s;
    // 周回はスタートのタイルに入った時点で数えるので、同じ位置で update した後なら s と食い違わない
    const lapsDone = this.laps.length - (this.started ? 0 : 1);
    return lapsDone * this.course.length + s;
  }

  /** 車を動かしてよいか（スタート前は止めておく） */
  get canDrive(): boolean {
    return this.phase !== 'countdown' && this.phase !== 'ready';
  }

  update(dt: number, car: { x: number; z: number; vx: number; vz: number }): void {
    if (this.phase === 'ready') return;
    if (this.phase === 'countdown') {
      const before = Math.ceil(-this.time);
      this.time += dt;
      const after = Math.ceil(-this.time);
      if (after !== before) this.events.push({ type: 'count', value: Math.max(0, after) });
      if (this.time >= 0) this.phase = 'racing';
      return;
    }
    if (this.phase === 'finished') return;
    this.time += dt;
    const speed = Math.hypot(car.vx, car.vz);
    const p = this.course.project(car.x, car.z, { s: this.hint, dir: speed > 1 ? { x: car.vx / speed, z: car.vz / speed } : null });
    this.hint = p.s;
    if (this.trackProgress(p.onCourse ? p.index : -1)) this.lastGoodS = p.s;
    this.checkDirection(dt, car);
  }

  /**
   * 近道をしたとき、車を戻す所（最後に正しくコースを走っていた所）のコース上の距離。
   * 戻した後に車の位置を取り違えないよう、ここから探し直す
   */
  rejoin(): number | null {
    if (this.lastGoodS === null) return null;
    this.hint = this.lastGoodS;
    return this.lastGoodS;
  }

  /** index はいまいる区間の番号（コースの外なら -1）。正しくコースの上にいれば true */
  private trackProgress(index: number): boolean {
    if (!this.course.closed) return this.trackOpen(index);
    const n = this.course.checkpoints;
    if (index < 0) return false;
    const ahead = (index - this.progress + n) % n;
    // 同じ所か、後ろへ戻ったとき（半周より後ろ）は、コースに戻っただけ
    if (ahead === 0 || ahead > n / 2) {
      this.setOffCourse(false);
      return true;
    }
    if (ahead > this.maxSkip) {
      // 大きく先へ飛んだのは、コースを外れて近道をしたとき
      this.setOffCourse(true);
      return false;
    }
    this.setOffCourse(false);
    const crossed = index < this.progress;
    this.progress = index;
    if (!crossed) return true;
    if (!this.started) {
      this.started = true;
      return true;
    }
    this.completeLap();
    return true;
  }

  /** 一本道のコース: スタートからゴールのタイルまで順にたどったらゴール */
  private trackOpen(index: number): boolean {
    if (index < 0) return false;
    if (index <= this.progress) {
      this.setOffCourse(false);
      return true;
    }
    if (index - this.progress > this.maxSkip) {
      this.setOffCourse(true);
      return false;
    }
    this.setOffCourse(false);
    this.progress = index;
    if (index >= this.course.finishIndex) this.completeLap();
    return true;
  }

  private completeLap(): void {
    const lapTime = this.time - this.lapStart;
    this.laps.push(lapTime);
    this.lapStart = this.time;
    this.events.push({ type: 'lap', lap: this.laps.length, time: lapTime });
    if (this.laps.length >= this.totalLaps) {
      this.phase = 'finished';
      this.setWrongWay(false);
      this.events.push({ type: 'finish', total: this.time, laps: [...this.laps] });
    }
  }

  private checkDirection(dt: number, car: { vx: number; vz: number }): void {
    const speed = Math.hypot(car.vx, car.vz);
    const dir = this.course.directionAt(Math.max(0, this.progress));
    const backwards = speed > 3 && (car.vx * dir.x + car.vz * dir.z) / speed < -0.5;
    this.wrongWayTime = backwards ? this.wrongWayTime + dt : 0;
    this.setWrongWay(this.wrongWayTime >= WRONG_WAY_SECONDS || (this.wrongWay && backwards));
  }

  private setWrongWay(on: boolean): void {
    if (on === this.wrongWay) return;
    this.wrongWay = on;
    this.events.push({ type: 'wrongWay', on });
  }

  private setOffCourse(on: boolean): void {
    if (on === this.offCourse) return;
    this.offCourse = on;
    this.events.push({ type: 'offCourse', on });
  }

  drainEvents(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** タイムの表示（1:23.45） */
export function formatTime(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
