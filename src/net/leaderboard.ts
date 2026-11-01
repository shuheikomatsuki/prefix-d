import { INPUT_STRIDE, inputsMatch } from '../race/ghost';

/**
 * タイムアタックのランキング（クライアントとサーバーで共有する）。
 * コースと車の組み合わせごとに1つのランキングがあり、1人につき一番速い記録だけを残す。
 * 記録にはゴーストと操作の記録も付けて送り、ランキングから選んだ人のゴーストと一緒に走ったり、リプレイを見たりできる。
 *
 * コースと車は、表示名ではなく変わらない id（MapDefinition.id・VehiclePreset.id）で区別する。
 * 表示名を変えてもランキングはそのまま残る。
 */

/** ランキングに出す数 */
export const BOARD_SIZE = 20;
/** サーバーに残す数（ランキングから外れた人が記録を縮めたとき、順位を正しく出すため少し多めに） */
export const STORED_ENTRIES = 50;
/** ランキングに出す名前の上限（文字数。オンラインの部屋での名前と同じ） */
export const MAX_ENTRY_NAME_LENGTH = 10;
/** ゴーストの数値の上限（10Hz × [x, z, yaw] で 15 分ぶん） */
export const MAX_GHOST_VALUES = 10 * 3 * 60 * 15;
/** 操作の記録（ゴーストの1点ごとに INPUT_STRIDE 個）の数値の上限 */
export const MAX_INPUT_VALUES = (MAX_GHOST_VALUES / 3) * INPUT_STRIDE;
export const MAX_LAPS = 20;

/** ランキングの1行（他の人にも見える情報） */
export interface LeaderboardEntry {
  id: string;
  name: string;
  /** 合計タイム [s] */
  total: number;
  laps: number[];
  /** 記録した日時 [ms] */
  date: number;
}

/** 車ごとのランキングをまとめて見るときの1行（どの車の記録か付ける） */
export interface CarEntry extends LeaderboardEntry {
  car: string;
}

/** 同じコースの車ごとのランキングを1つにまとめ、速い順に size 件にする（同じ人でも車が違えば別の行） */
export function mergeBoards(boards: readonly { car: string; entries: readonly LeaderboardEntry[] }[], size = BOARD_SIZE): CarEntry[] {
  return boards
    .flatMap(({ car, entries }) => entries.map((e) => ({ ...e, car })))
    .sort((a, b) => a.total - b.total || a.date - b.date)
    .slice(0, size);
}

/** サーバーに保存する1行。player は送ってきた人を見分ける秘密の id で、他の人には見せない */
export interface StoredEntry extends LeaderboardEntry {
  player: string;
}

/** 記録を送るときの中身 */
export interface Submission {
  /** このブラウザで作った秘密の id（同じ人の記録をまとめる） */
  player: string;
  name: string;
  total: number;
  laps: number[];
  ghost: number[];
  /** 操作の記録（リプレイ用。ゴーストと数が合わなければ捨てる） */
  inputs?: number[];
}

/** ランキングの人の走り（ゴーストと、あれば操作の記録） */
export interface RunData {
  ghost: number[];
  inputs: number[];
}

export interface SubmitResult {
  /** 自分の順位（1 から。ランキングの外なら null） */
  rank: number | null;
  /** 今回の記録で自分のベストを縮めたか */
  improved: boolean;
  entries: LeaderboardEntry[];
}

/** コース・車の id として受け付ける形 */
export function isBoardKey(s: string): boolean {
  return /^[a-z0-9-]{1,32}$/.test(s);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 送られてきた記録を確かめる（おかしければ null） */
export function parseSubmission(body: unknown): Submission | null {
  if (typeof body !== 'object' || body === null) return null;
  const o = body as Partial<Submission>;
  if (typeof o.player !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(o.player)) return null;
  const name = typeof o.name === 'string' ? [...o.name.trim()].slice(0, MAX_ENTRY_NAME_LENGTH).join('').trim() : '';
  if (!name) return null;
  if (!finite(o.total) || o.total <= 0 || o.total > 3600) return null;
  if (!Array.isArray(o.laps) || o.laps.length === 0 || o.laps.length > MAX_LAPS || !o.laps.every((t) => finite(t) && t > 0)) return null;
  if (!Array.isArray(o.ghost) || o.ghost.length > MAX_GHOST_VALUES || o.ghost.length % 3 !== 0 || !o.ghost.every(finite)) return null;
  const inputs =
    Array.isArray(o.inputs) && o.inputs.length <= MAX_INPUT_VALUES && o.inputs.every((v) => Number.isInteger(v) && Math.abs(v) <= 10_000) && inputsMatch(o.inputs, o.ghost.length)
      ? o.inputs
      : undefined;
  return { player: o.player, name, total: o.total, laps: o.laps, ghost: o.ghost, ...(inputs ? { inputs } : {}) };
}

export function publicEntry({ id, name, total, laps, date }: StoredEntry): LeaderboardEntry {
  return { id, name, total, laps, date };
}

/**
 * 記録をランキングに反映する。同じ人の前の記録より速ければ置き換え、遅ければ名前だけ新しくする。
 * removed は消えた記録の id（そのゴーストも消す）。saved は新しく残した記録（そのゴーストを保存する）
 */
export function applySubmission(
  stored: readonly StoredEntry[],
  sub: Submission,
  newId: string,
  now: number,
): { entries: StoredEntry[]; result: SubmitResult; removed: string[]; saved: StoredEntry | null } {
  const mine = stored.find((e) => e.player === sub.player);
  const improved = !mine || sub.total < mine.total;
  let entries = stored.filter((e) => e.player !== sub.player);
  const removed: string[] = [];
  let saved: StoredEntry | null = null;
  if (improved) {
    if (mine) removed.push(mine.id);
    saved = { id: newId, player: sub.player, name: sub.name, total: sub.total, laps: sub.laps, date: now };
    entries.push(saved);
  } else {
    entries.push({ ...mine!, name: sub.name });
  }
  entries.sort((a, b) => a.total - b.total || a.date - b.date);
  for (const e of entries.slice(STORED_ENTRIES)) removed.push(e.id);
  entries = entries.slice(0, STORED_ENTRIES);
  // ランキングから外れたなら、保存もしない
  if (saved && !entries.includes(saved)) saved = null;
  const index = entries.findIndex((e) => e.player === sub.player);
  return {
    entries,
    removed: removed.filter((id) => id !== newId),
    saved,
    result: {
      rank: index >= 0 && index < BOARD_SIZE ? index + 1 : null,
      improved,
      entries: entries.slice(0, BOARD_SIZE).map(publicEntry),
    },
  };
}
