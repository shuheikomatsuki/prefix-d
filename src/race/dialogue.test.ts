import { describe, expect, it } from 'vitest';
import { type BattleContext, BattleDialogue, type BattleSnapshot, CornerWatcher, EdgeWatcher, OvertakeWatcher, dialogueApplies, insideOf, MAX_LINE_CHARS, lineDuration, sceneLines, splitLine, turnAround, wentWide } from './dialogue';
import { CHARACTERS, RIVAL_DIALOGUES } from './dialogueScript';
import { RIVALS } from './rivals';
import { VEHICLE_PRESETS } from '../sim/vehicle';

const ctx: BattleContext = {
  course: 'pass-down',
  homeCourse: 'pass-down',
  playerCar: 'ae86',
  rule: 'side',
  playerLeads: false,
  round: 1,
  weather: 'clear',
  time: 'night',
};

const snap = (s: Partial<BattleSnapshot>): BattleSnapshot => ({
  elapsed: 10,
  lap: 1,
  lapDistance: 0,
  ahead: false,
  gap: 20,
  speedKmh: 100,
  progress: 0.5,
  events: [],
  ...s,
});

const line = (text: string) => [{ who: 'takumi', text }];

describe('dialogueApplies', () => {
  it('はじめは得意なコースのときだけ', () => {
    expect(dialogueApplies({}, ctx)).toBe(true);
    expect(dialogueApplies({}, { ...ctx, course: 'pass-up' })).toBe(false);
    expect(dialogueApplies({ onlyHomeCourse: false }, { ...ctx, course: 'pass-up' })).toBe(true);
    expect(dialogueApplies(undefined, ctx)).toBe(false);
  });

  it('自分の車などの条件を見る', () => {
    expect(dialogueApplies({ when: { playerCar: 'ae86' } }, ctx)).toBe(true);
    expect(dialogueApplies({ when: { playerCar: ['fd3s', 'r34'] } }, ctx)).toBe(false);
    expect(dialogueApplies({ when: { time: 'night', weather: ['clear', 'fog'] } }, ctx)).toBe(true);
  });
});

describe('sceneLines', () => {
  it('条件に合う最初の場面を使う', () => {
    const scenes = [
      { when: { weather: 'rain' as const }, say: line('雨') },
      { when: { rule: 'suddenDeath' as const, playerLeads: true }, say: line('先行') },
      { say: line('ふつう') },
    ];
    expect(sceneLines(scenes, ctx)[0].text).toBe('ふつう');
    expect(sceneLines(scenes, { ...ctx, weather: 'rain' })[0].text).toBe('雨');
    expect(sceneLines(scenes, { ...ctx, rule: 'suddenDeath', playerLeads: true })[0].text).toBe('先行');
    expect(sceneLines(undefined, ctx)).toEqual([]);
  });
});

describe('BattleDialogue', () => {
  it('その場所を通ったときに1回だけ出す', () => {
    const d = new BattleDialogue([{ when: { at: 500 }, say: line('ここだ') }], ctx);
    expect(d.update(snap({ lapDistance: 490 }))).toEqual([]);
    expect(d.update(snap({ lapDistance: 501 }))[0].text).toBe('ここだ');
    expect(d.update(snap({ lapDistance: 510 }))).toEqual([]);
  });

  it('場所の条件は、同時にほかの条件も満たしているときだけ', () => {
    const d = new BattleDialogue([{ when: { at: 500, position: 'ahead', gap: { min: 30 } }, say: line('離した') }], ctx);
    expect(d.update(snap({ lapDistance: 490, ahead: true, gap: 10 }))).toEqual([]);
    expect(d.update(snap({ lapDistance: 505, ahead: true, gap: 10 }))).toEqual([]);
    const d2 = new BattleDialogue([{ when: { at: 500, position: 'ahead', gap: { min: 30 } }, say: line('離した') }], ctx);
    d2.update(snap({ lapDistance: 490 }));
    expect(d2.update(snap({ lapDistance: 505, ahead: true, gap: 40 }))).toHaveLength(1);
  });

  it('周回コースは周ごとに場所を数え、lap で周を選べる', () => {
    const d = new BattleDialogue([{ when: { at: 100, lap: 2 }, say: line('2周目') }], ctx);
    d.update(snap({ lapDistance: 90 }));
    expect(d.update(snap({ lapDistance: 110 }))).toEqual([]);
    // 周が変わった直後は前の距離と比べない（周の終わり→始まりで通ったことにしない）
    d.update(snap({ lap: 2, lapDistance: 2 }));
    expect(d.update(snap({ lap: 2, lapDistance: 101 }))).toHaveLength(1);
  });

  it('出来事のセリフ。repeat なら何度でも', () => {
    const d = new BattleDialogue(
      [
        { when: { event: 'overtaken' }, say: line('抜かれた') },
        { when: { event: 'crash' }, say: line('ぶつかった'), repeat: true },
      ],
      ctx,
    );
    expect(d.update(snap({ events: ['overtaken'] }))).toHaveLength(1);
    expect(d.update(snap({ events: ['overtaken'] }))).toEqual([]);
    expect(d.update(snap({ events: ['crash'] }))).toHaveLength(1);
    expect(d.update(snap({}))).toEqual([]);
    expect(d.update(snap({ events: ['crash'] }))).toHaveLength(1);
  });

  it('oneAtATime は1つずつ順に出し、onlyWhenQuiet はほかの字幕が出ている間は言わない', () => {
    const d = new BattleDialogue(
      [{ when: { event: 'rivalCorner' }, repeat: true, oneAtATime: true, onlyWhenQuiet: true, say: [...line('どりゃー'), ...line('ふりゃー')] }],
      ctx,
    );
    const corner = (quiet = true) => d.update(snap({ events: ['rivalCorner'], quiet })).map((l) => l.text);
    expect(corner()).toEqual(['どりゃー']);
    expect(corner(false)).toEqual([]);
    expect(corner()).toEqual(['ふりゃー']);
    expect(corner()).toEqual(['どりゃー']);
  });

  it('場所も出来事もない条件は、満たした瞬間に出す（repeat は満たさなくなってから再び満たしたとき）', () => {
    const d = new BattleDialogue([{ when: { speed: { min: 150 } }, say: line('速い'), repeat: true }], ctx);
    expect(d.update(snap({ speedKmh: 160 }))).toHaveLength(1);
    expect(d.update(snap({ speedKmh: 170 }))).toEqual([]);
    d.update(snap({ speedKmh: 120 }));
    expect(d.update(snap({ speedKmh: 155 }))).toHaveLength(1);
  });

  it('時間・後ろにいる・差の範囲', () => {
    const d = new BattleDialogue([{ when: { elapsed: { min: 30 }, position: 'behind', gap: { max: 10 } }, say: line('食らいつく') }], ctx);
    expect(d.update(snap({ elapsed: 20, gap: 5 }))).toEqual([]);
    expect(d.update(snap({ elapsed: 31, gap: 15 }))).toEqual([]);
    expect(d.update(snap({ elapsed: 32, gap: 5, ahead: true }))).toEqual([]);
    expect(d.update(snap({ elapsed: 33, gap: 5 }))).toHaveLength(1);
  });
});

describe('progress', () => {
  it('終盤（進んだ割合）の条件', () => {
    const d = new BattleDialogue([{ when: { progress: { min: 0.7 }, position: 'behind', gap: { max: 6 } }, say: line('終盤') }], ctx);
    expect(d.update(snap({ progress: 0.5, gap: 3 }))).toEqual([]);
    expect(d.update(snap({ progress: 0.8, gap: 10 }))).toEqual([]);
    expect(d.update(snap({ progress: 0.85, gap: 4 }))).toHaveLength(1);
  });
});

describe('OvertakeWatcher', () => {
  it('前後が入れ替わったら抜いた・抜かれた（並んでいる間は数えない）', () => {
    const w = new OvertakeWatcher(2);
    expect(w.update(-10)).toBeNull();
    expect(w.update(1)).toBeNull();
    expect(w.update(3)).toBe('overtake');
    expect(w.update(-1)).toBeNull();
    expect(w.update(5)).toBeNull();
    expect(w.update(-3)).toBe('overtaken');
  });
});

describe('コーナーでの出来事', () => {
  it('出来事を配列で書くと、どれかが起きたときに出す（1回だけ）', () => {
    const d = new BattleDialogue([{ when: { event: ['rivalWide', 'overtakeInside'] }, say: line('しまった') }], ctx);
    expect(d.update(snap({ events: ['overtake'] }))).toEqual([]);
    expect(d.update(snap({ events: ['overtake', 'overtakeInside'] }))).toHaveLength(1);
    expect(d.update(snap({ events: ['rivalWide'] }))).toEqual([]);
  });

  it('曲がる向きを、前後の道の向きの差から出す（正は左）', () => {
    // s が大きいほど左へ向きが変わる道
    const left = { pointAt: (s: number) => ({ x: 0, z: 0, yaw: s * 0.01 }) };
    expect(turnAround(left, 100, 20)).toBeCloseTo(0.4);
    const straight = { pointAt: () => ({ x: 0, z: 0, yaw: 3 }) };
    expect(turnAround(straight, 100)).toBe(0);
  });

  it('コーナーの外側へはみ出したときだけ、外へはみ出したとみなす', () => {
    // 左コーナー（turn > 0）の外側は右（offset < 0）
    expect(wentWide(0.5, -4, 1)).toBe(true);
    expect(wentWide(0.5, 4, 1)).toBe(false);
    expect(wentWide(0.5, -4, 0)).toBe(false);
    expect(wentWide(0.05, -4, 1)).toBe(false);
    expect(wentWide(-0.5, 4, 1)).toBe(true);
  });

  it('コーナーで内側にいるか', () => {
    expect(insideOf(0.5, 2, 0)).toBe(true);
    expect(insideOf(0.5, -2, 0)).toBe(false);
    expect(insideOf(-0.5, -2, 0)).toBe(true);
    expect(insideOf(0.05, 2, 0)).toBe(false);
  });

  it('はみ出した瞬間だけ知らせる', () => {
    const w = new EdgeWatcher();
    expect([false, true, true, false, true].map((v) => w.update(v))).toEqual([false, true, false, false, true]);
  });

  it('コーナーに入った瞬間だけ知らせる（抜けるまでは同じコーナー）', () => {
    const w = new CornerWatcher();
    expect([0.1, 0.6, 0.9, 0.4, 0.6, 0.1, -0.7].map((v) => w.update(v))).toEqual([false, true, false, false, false, false, true]);
  });
});

describe('lineDuration', () => {
  it('長いセリフほど長く出す（2.5〜10秒）', () => {
    expect(lineDuration('あ')).toBe(2.5);
    expect(lineDuration('あ'.repeat(30))).toBeGreaterThan(lineDuration('あ'.repeat(10)));
    expect(lineDuration('あ'.repeat(200))).toBe(10);
  });
});

describe('dialogueScript', () => {
  it('書いたライバルと車の id が正しく、セリフが空でない', () => {
    const cars = new Set(VEHICLE_PRESETS.map((v) => v.id));
    for (const [id, d] of Object.entries(RIVAL_DIALOGUES)) {
      expect(RIVALS.some((r) => r.id === id), id).toBe(true);
      const scenes = [...(d.intro ?? []), ...(d.win ?? []), ...(d.lose ?? []), ...(d.draw ?? []), ...(d.race ?? [])];
      const conds = [d.when, ...scenes.map((s) => s.when)];
      for (const c of conds) {
        for (const car of [c?.playerCar ?? []].flat()) expect(cars.has(car), `${id}: ${car}`).toBe(true);
      }
      for (const s of scenes) for (const l of s.say) expect(l.text.trim(), `${id}: ${l.who}`).not.toBe('');
    }
    for (const c of Object.values(CHARACTERS)) expect(c.name).not.toBe('');
  });
});

describe('splitLine', () => {
  it('keeps short lines as they are', () => {
    expect(splitLine('峠の王者はランエボだ！！')).toEqual(['峠の王者はランエボだ！！']);
  });

  it('splits long lines at sentence ends and spaces, and merges short sentences', () => {
    const parts = splitLine('見通しが悪く狭かった道路がここから急に変わる。拡幅工事が終わった新設の第2セクション。見た目は綺麗だが路面はひどいもんだな。アスファルトの継ぎ目がバンピーで跳ねまくる。');
    expect(parts.length).toBeGreaterThan(2);
    for (const p of parts) expect([...p].length).toBeLessThanOrEqual(MAX_LINE_CHARS);
    expect(parts.join('')).toBe('見通しが悪く狭かった道路がここから急に変わる。拡幅工事が終わった新設の第2セクション。見た目は綺麗だが路面はひどいもんだな。アスファルトの継ぎ目がバンピーで跳ねまくる。');
    expect(splitLine('リアサイドについているRのバッジは不敗神話のRだ！！ オレのRについて来れるか！？')).toEqual([
      'リアサイドについているRのバッジは不敗神話のRだ！！',
      'オレのRについて来れるか！？',
    ]);
  });

  it('splits at line breaks and at commas when a sentence is too long', () => {
    expect(splitLine('どうしたんだ\nクソッタレが')).toEqual(['どうしたんだ クソッタレが']);
    const parts = splitLine('プロとアマの間にどれくらいの差があるのか、お前らもよくみておけよ。', 20);
    expect(parts).toEqual(['プロとアマの間にどれくらいの差があるのか、', 'お前らもよくみておけよ。']);
  });
});
