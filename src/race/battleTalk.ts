import type { Level } from '../game/level';
import type { Npc } from '../game/npcRace';
import type { CarSnapshot } from '../sim/car';
import type { Subtitles } from '../ui/subtitles';
import { type BattleContext, BattleDialogue, type BattleEvent, EdgeWatcher, OvertakeWatcher, type RivalDialogue, dialogueApplies, insideOf, sceneLines, turnAround, wentWide } from './dialogue';
import { RIVAL_DIALOGUES } from './dialogueScript';
import type { TimeAttack } from './timeAttack';

/** セリフの 'crash'（壁に強くぶつかった）とみなす衝突の強さ [m/s] */
export const CRASH_THRESHOLD = 7;

/** 走っている間の様子（毎ステップ） */
export interface TalkFrame {
  race: TimeAttack;
  npc: Npc;
  level: Level;
  /** 自分の車 */
  car: CarSnapshot;
  /** このステップで自分の車が受けた衝突の強さ [m/s] */
  impact: number;
}

/** ライバルとのバトルのセリフ（スタート前・走行中・勝負のあとの場面） */
export class BattleTalk {
  /** いまのバトルのセリフ（セリフの無いライバルや、得意なコース以外では null） */
  private talk: { script: RivalDialogue; ctx: BattleContext; lines: BattleDialogue; overtakes: OvertakeWatcher; wide: EdgeWatcher; inside: boolean; bumped: boolean } | null = null;

  constructor(private readonly subtitles: Subtitles) {}

  /** セリフを用意し、スタート前の場面を出す（先行後追いの2本目からは、round を書いた場面だけ）。rival が null ならバトルではない */
  start(rival: string | null, ctx: BattleContext | null, nextRound: boolean): void {
    this.subtitles.clear();
    this.talk = null;
    if (!rival || !ctx) return;
    const script = RIVAL_DIALOGUES[rival];
    if (!dialogueApplies(script, ctx)) return;
    this.talk = { script, ctx, lines: new BattleDialogue(script.race ?? [], ctx), overtakes: new OvertakeWatcher(), wide: new EdgeWatcher(), inside: false, bumped: false };
    const intro = nextRound ? (script.intro ?? []).filter((sc) => sc.when?.round !== undefined) : script.intro;
    this.subtitles.playScene(sceneLines(intro, ctx), () => {});
  }

  /** レースをやめたとき */
  clear(): void {
    this.subtitles.clear();
    this.talk = null;
  }

  /** ラフプレーのライバルにぶつけられた */
  bumped(): void {
    if (this.talk) this.talk.bumped = true;
  }

  /** 勝負のあとの場面（セリフが無ければすぐ）を出してから then を呼ぶ */
  outcome(kind: 'win' | 'lose' | 'draw', then: () => void): void {
    const t = this.talk;
    if (!t) return then();
    this.subtitles.playScene(sceneLines(t.script[kind], t.ctx), then);
  }

  /** 走っている間のセリフ（毎ステップ） */
  update({ race, npc, level, car, impact }: TalkFrame): void {
    const t = this.talk;
    if (!t || race.phase !== 'racing') return;
    const mine = race.distance(car.x, car.z);
    const signedGap = mine - npc.timer.distance(npc.curr.x, npc.curr.z);
    const events: BattleEvent[] = [];
    const pass = t.overtakes.update(signedGap);
    if (pass) events.push(pass);
    if (impact > CRASH_THRESHOLD) events.push('crash');
    const course = race.course;
    // コーナーでの位置: ライバルが外へはみ出したか・自分がインから抜いたか
    const rp = course.project(npc.curr.x, npc.curr.z, { s: npc.curr.courseS ?? null });
    const turn = turnAround(course, rp.s);
    if (t.wide.update(wentWide(turn, rp.offset, level.offRoadDistance(npc.curr.x, npc.curr.z, npc.curr.courseS) ?? 0))) events.push('rivalWide');
    // 抜いたと分かるのは少し前に出てからなので、横に並んでいた間にインにいたかを覚えておく
    if (Math.abs(signedGap) < 4) t.inside = insideOf(turn, course.project(car.x, car.z, { s: car.courseS ?? null }).offset, rp.offset);
    if (pass === 'overtake' && t.inside) events.push('overtakeInside');
    if (t.bumped) events.push('rivalBump');
    t.bumped = false;
    const lapDistance = course.closed ? mine - (race.lap - 1) * course.length : mine;
    const progress = Math.min(1, Math.max(0, mine / (course.length * (course.closed ? race.totalLaps : 1))));
    this.subtitles.say(
      t.lines.update({
        elapsed: race.time,
        lap: race.lap,
        lapDistance,
        ahead: signedGap > 0,
        gap: Math.abs(signedGap),
        speedKmh: Math.abs(car.forwardSpeed) * 3.6,
        progress,
        events,
      }),
    );
  }
}
