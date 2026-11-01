import { DurableObject } from 'cloudflare:workers';
import {
  BOARD_SIZE,
  type StoredEntry,
  applySubmission,
  parseSubmission,
  publicEntry,
} from '../../src/net/leaderboard';

/** 送られてくる記録の大きさの上限 [byte]（15 分ぶんのゴーストと操作の記録が収まる） */
const MAX_BODY_BYTES = 1_500_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * 1つのランキング（コースと車の組み合わせ）= 1つの Durable Object。
 * 記録の一覧を 'entries' に、それぞれのゴーストを 'ghost:<id>'、操作の記録を 'inputs:<id>' に保存する（SQLite 版の KV）。
 */
export class Leaderboard extends DurableObject {
  private entries(): StoredEntry[] {
    return this.ctx.storage.kv.get<StoredEntry[]>('entries') ?? [];
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ghost = url.pathname.match(/\/ghosts\/([A-Za-z0-9-]+)$/);
    if (request.method === 'GET' && ghost) {
      const data = this.ctx.storage.kv.get<number[]>(`ghost:${ghost[1]}`);
      // 操作の記録は、入れる前に送られた記録には無い
      return data ? json({ ghost: data, inputs: this.ctx.storage.kv.get<number[]>(`inputs:${ghost[1]}`) ?? [] }) : json({ error: 'not found' }, 404);
    }
    if (request.method === 'GET') {
      return json({ entries: this.entries().slice(0, BOARD_SIZE).map(publicEntry) });
    }
    if (request.method === 'POST') {
      if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return json({ error: 'too large' }, 413);
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: 'too large' }, 413);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: 'bad json' }, 400);
      }
      const sub = parseSubmission(body);
      if (!sub) return json({ error: 'bad record' }, 400);
      const { entries, result, removed, saved } = applySubmission(this.entries(), sub, crypto.randomUUID(), Date.now());
      if (saved) {
        this.ctx.storage.kv.put(`ghost:${saved.id}`, sub.ghost);
        if (sub.inputs) this.ctx.storage.kv.put(`inputs:${saved.id}`, sub.inputs);
      }
      for (const id of removed) {
        this.ctx.storage.kv.delete(`ghost:${id}`);
        this.ctx.storage.kv.delete(`inputs:${id}`);
      }
      this.ctx.storage.kv.put('entries', entries);
      return json(result);
    }
    return json({ error: 'method not allowed' }, 405);
  }
}
