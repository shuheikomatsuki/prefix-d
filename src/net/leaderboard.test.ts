import { describe, expect, it } from 'vitest';
import { BOARD_SIZE, STORED_ENTRIES, type StoredEntry, type Submission, applySubmission, isBoardKey, mergeBoards, parseSubmission } from './leaderboard';

const sub = (player: string, total: number, name = player): Submission => ({ player, name, total, laps: [total / 2, total / 2], ghost: [0, 0, 0, 1, 1, 0] });
const PLAYER_A = 'aaaaaaaa-1';
const PLAYER_B = 'bbbbbbbb-2';

describe('parseSubmission', () => {
  it('accepts a valid record and trims the name', () => {
    expect(parseSubmission({ ...sub(PLAYER_A, 90), name: '  しゅうへい  ' })?.name).toBe('しゅうへい');
  });

  it('cuts the name to 10 characters', () => {
    expect(parseSubmission({ ...sub(PLAYER_A, 90), name: 'あいうえおかきくけこさしすせそ' })?.name).toBe('あいうえおかきくけこ');
  });

  it('rejects broken records', () => {
    expect(parseSubmission(null)).toBeNull();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), name: '   ' })).toBeNull();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), player: 'x' })).toBeNull();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), total: Number.NaN })).toBeNull();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), laps: [] })).toBeNull();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), ghost: [1, 2] })).toBeNull();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), ghost: 'abc' })).toBeNull();
  });

  it('keeps the inputs only when they match the ghost', () => {
    const inputs = [0, 100, 0, 200, 0, -50, 0, 80, 150, 30];
    expect(parseSubmission({ ...sub(PLAYER_A, 90), inputs })?.inputs).toEqual(inputs);
    // 数が合わない・整数でない記録は、操作だけ捨てる（記録そのものは受け付ける）
    expect(parseSubmission({ ...sub(PLAYER_A, 90), inputs: [1, 2, 3] })?.inputs).toBeUndefined();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), inputs: inputs.map((v) => v + 0.5) })?.inputs).toBeUndefined();
    expect(parseSubmission({ ...sub(PLAYER_A, 90), inputs: 'x' })).not.toBeNull();
  });
});

describe('applySubmission', () => {
  it('keeps only the best record of each player, fastest first', () => {
    let stored: StoredEntry[] = [];
    const run = (s: Submission, id: string, now: number) => {
      const r = applySubmission(stored, s, id, now);
      stored = r.entries;
      return r;
    };
    expect(run(sub(PLAYER_A, 100), 'a1', 1).result).toMatchObject({ rank: 1, improved: true });
    expect(run(sub(PLAYER_B, 90), 'b1', 2).result).toMatchObject({ rank: 1, improved: true });
    // 遅い記録では置き換えないが、名前は新しくする
    const slower = run(sub(PLAYER_A, 120, 'しゅう'), 'a2', 3);
    expect(slower.result).toMatchObject({ rank: 2, improved: false });
    expect(slower.saved).toBeNull();
    expect(slower.removed).toEqual([]);
    expect(stored.map((e) => [e.id, e.name])).toEqual([
      ['b1', PLAYER_B],
      ['a1', 'しゅう'],
    ]);
    // 速い記録は前の記録（とゴースト）を置き換える
    const faster = run(sub(PLAYER_A, 80), 'a3', 4);
    expect(faster.result).toMatchObject({ rank: 1, improved: true });
    expect(faster.saved?.id).toBe('a3');
    expect(faster.removed).toEqual(['a1']);
    // 他の人に見せる一覧には、送った人の秘密の id を含めない
    expect(faster.result.entries[0]).not.toHaveProperty('player');
  });

  it('drops records beyond the stored size', () => {
    let stored: StoredEntry[] = [];
    for (let i = 0; i < STORED_ENTRIES; i++) stored = applySubmission(stored, sub(`player-${String(i).padStart(4, '0')}`, 60 + i), `id${i}`, i).entries;
    const slow = applySubmission(stored, sub('player-slow', 999), 'slow', 100);
    expect(slow.saved).toBeNull();
    expect(slow.removed).toEqual([]);
    expect(slow.result.rank).toBeNull();
    expect(slow.result.entries).toHaveLength(BOARD_SIZE);
    const fast = applySubmission(stored, sub('player-fast', 10), 'fast', 100);
    expect(fast.result.rank).toBe(1);
    expect(fast.removed).toEqual([`id${STORED_ENTRIES - 1}`]);
  });

  it('checks board keys', () => {
    expect(isBoardKey('circuit')).toBe(true);
    expect(isBoardKey('standard')).toBe(true);
    expect(isBoardKey('サーキット')).toBe(false);
    expect(isBoardKey('../x')).toBe(false);
  });
});

describe('mergeBoards', () => {
  it('lists records of every car fastest first, tagged with the car', () => {
    const e = (id: string, total: number, date = 0) => ({ id, name: id, total, laps: [total], date });
    const merged = mergeBoards(
      [
        { car: 'ae86', entries: [e('a', 90), e('b', 100)] },
        { car: 'gtr', entries: [e('c', 85), e('d', 90, 1)] },
      ],
      3,
    );
    expect(merged.map((m) => [m.id, m.car])).toEqual([
      ['c', 'gtr'],
      ['a', 'ae86'],
      ['d', 'gtr'],
    ]);
  });
});
