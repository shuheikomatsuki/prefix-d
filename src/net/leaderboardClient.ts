import { inputsMatch } from '../race/ghost';
import type { LeaderboardEntry, RunData, Submission, SubmitResult } from './leaderboard';

const PLAYER_KEY = 'car-game:player-id';
const UPLOADED_PREFIX = 'car-game:uploaded:v1:';
const MY_ENTRY_PREFIX = 'car-game:my-entry:v1:';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できない環境
  }
}

/** このブラウザの秘密の id（ランキングで同じ人の記録をまとめる）。初めて使うときに作る */
export function playerId(): string {
  let id = storageGet(PLAYER_KEY);
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = crypto.randomUUID();
    storageSet(PLAYER_KEY, id);
  }
  return id;
}

/** そのランキングへ最後に送った合計タイム（同じ記録を何度も送らないため） */
export function uploadedTotal(course: string, car: string): number | null {
  const v = Number(storageGet(`${UPLOADED_PREFIX}${course}:${car}`));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function markUploaded(course: string, car: string, total: number): void {
  storageSet(`${UPLOADED_PREFIX}${course}:${car}`, String(total));
}

/** そのランキングでの自分の記録の id（一覧で自分の行を目立たせる） */
export function myEntryId(course: string, car: string): string | null {
  return storageGet(`${MY_ENTRY_PREFIX}${course}:${car}`);
}

export function setMyEntryId(course: string, car: string, id: string): void {
  storageSet(`${MY_ENTRY_PREFIX}${course}:${car}`, id);
}

/** オンラインのランキング（サーバーの /boards/<コース>/<車>）を読み書きする */
export class LeaderboardClient {
  private readonly base: string;

  constructor(serverUrl: string) {
    const url = new URL(serverUrl);
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (url.protocol === 'wss:') url.protocol = 'https:';
    this.base = url.toString().replace(/\/$/, '');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}/boards/${path}`, init);
    if (!res.ok) throw new Error(res.status === 403 ? 'このページや地域からはランキングを使えません' : `サーバーのエラー（${res.status}）`);
    return (await res.json()) as T;
  }

  async list(course: string, car: string): Promise<LeaderboardEntry[]> {
    return (await this.request<{ entries: LeaderboardEntry[] }>(`${course}/${car}`)).entries;
  }

  /** その記録のゴーストと操作の記録（古いサーバー・古い記録なら操作は空） */
  async run(course: string, car: string, id: string): Promise<RunData> {
    const r = await this.request<{ ghost: number[]; inputs?: number[] }>(`${course}/${car}/ghosts/${id}`);
    const inputs = Array.isArray(r.inputs) && inputsMatch(r.inputs, r.ghost.length) ? r.inputs : [];
    return { ghost: r.ghost, inputs };
  }

  async submit(course: string, car: string, sub: Submission): Promise<SubmitResult> {
    const result = await this.request<SubmitResult>(`${course}/${car}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sub),
    });
    markUploaded(course, car, sub.total);
    if (result.rank !== null) setMyEntryId(course, car, result.entries[result.rank - 1].id);
    return result;
  }
}
