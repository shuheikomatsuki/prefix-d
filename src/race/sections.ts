import type { Course } from './course';
import type { TimeAttack } from './timeAttack';

/** 区間1つのおおよその長さ [m]（コースの長さから区間の数を決める） */
const SECTION_LENGTH = 700;
const MIN_SECTIONS = 3;
const MAX_SECTIONS = 8;
/** 1ステップでこれより大きく進んだら、コースに戻されたなどの飛びとして数えない [m] */
const MAX_JUMP = 30;

/** コース（1周・ゴールまで）を分ける区間の数 */
export function sectionCount(length: number): number {
  return Math.min(MAX_SECTIONS, Math.max(MIN_SECTIONS, Math.round(length / SECTION_LENGTH)));
}

/**
 * レースの区切りを通った時刻を記録する。区切りはコースを sections 個に等分した所で、周回コースなら周ごとに同じ所。
 * distance はスタートラインから進んだ距離（周回分を含む。TimeAttack.distance）
 */
export class SectionClock {
  /** times[k] は k+1 番目の区切り（周回を通して数える）を通った時刻 [s] */
  readonly times: number[] = [];
  private last: { time: number; distance: number } | null = null;

  constructor(
    readonly courseLength: number,
    readonly sections: number,
    readonly laps: number,
  ) {}

  /** 区切りの、スタートからの距離 [m] */
  bound(k: number): number {
    return (this.courseLength * (k + 1)) / this.sections;
  }

  get total(): number {
    return this.sections * this.laps;
  }

  /** 走っている間、毎ステップ呼ぶ。valid が false の間（コースの外・近道）は進んだことにしない */
  update(time: number, distance: number, valid = true): void {
    if (!valid || (this.last && Math.abs(distance - this.last.distance) > MAX_JUMP)) {
      this.last = null;
      return;
    }
    const prev = this.last ?? { time, distance };
    this.last = { time, distance };
    // 飛んだ後で区切りを越えていたら、走り直し始めた時刻に通ったことにする（区切りの記録が止まらないように）
    while (this.times.length < this.total - 1 && distance >= this.bound(this.times.length)) {
      const b = this.bound(this.times.length);
      const f = distance > prev.distance ? Math.min(1, Math.max(0, (b - prev.distance) / (distance - prev.distance))) : 1;
      this.times.push(prev.time + (time - prev.time) * f);
    }
  }

  /** ゴールした時刻。最後の区切り（ゴール）はここで記録する */
  finish(time: number): void {
    while (this.times.length < this.total) this.times.push(time);
  }

  /** k 番目の区間（周回を通して数える）にかかった時間。まだ通っていなければ null */
  sectionTime(k: number): number | null {
    if (k >= this.times.length) return null;
    return this.times[k] - (k === 0 ? 0 : this.times[k - 1]);
  }
}

/** コースの区間ごとの、自分と相手のタイム差 */
export interface SectionGaps {
  /** gaps[i] はコースの i 番目の区間での差 [s]（周回分を足したもの。正なら自分が遅い）。どちらかがまだ通っていなければ null */
  gaps: (number | null)[];
  /** いちばん離された区間（遅れていなければ null） */
  worst: number | null;
  /** いちばん速かった区間（勝っていなければ null） */
  best: number | null;
}

/** 自分（me）と相手（them）の区間タイムを比べる。周回コースは同じ区間の周ごとの差を足す */
export function compareSections(me: SectionClock, them: SectionClock): SectionGaps {
  const gaps: (number | null)[] = Array.from({ length: me.sections }, () => null);
  for (let k = 0; k < me.total; k++) {
    const a = me.sectionTime(k);
    const b = them.sectionTime(k);
    if (a === null || b === null) continue;
    const i = k % me.sections;
    gaps[i] = (gaps[i] ?? 0) + a - b;
  }
  let worst: number | null = null;
  let best: number | null = null;
  gaps.forEach((g, i) => {
    if (g === null) return;
    if (g > 0 && (worst === null || g > gaps[worst]!)) worst = i;
    if (g < 0 && (best === null || g < gaps[best]!)) best = i;
  });
  return { gaps, worst, best };
}

/** 地図に描くための、区間ごとの中心線の点 */
export function sectionPaths(course: Pick<Course, 'length' | 'pointAt'>, sections: number, pointsPerSection = 40): { x: number; z: number }[][] {
  return Array.from({ length: sections }, (_, i) =>
    Array.from({ length: pointsPerSection + 1 }, (_, j) => {
      const p = course.pointAt((course.length * (i + j / pointsPerSection)) / sections);
      return { x: p.x, z: p.z };
    }),
  );
}

/** そのステップの計測（timer）と車の位置から、区切りを通った時刻を記録する。ゴールしていれば最後の区切りも */
export function trackSections(clock: SectionClock, timer: TimeAttack, car: { x: number; z: number }): void {
  if (timer.phase === 'racing') clock.update(timer.time, timer.distance(car.x, car.z), !timer.isOffCourse);
  else if (timer.phase === 'finished') clock.finish(timer.time);
}
