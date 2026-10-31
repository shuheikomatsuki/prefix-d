import { describe, expect, it } from 'vitest';
import { netStatusHtml } from './netStatus';

const base = { roomCode: 'ABCD', connected: true, selfColor: 0xff0000, others: [], race: null, maxPlayers: 8 } as const;

describe('netStatusHtml', () => {
  it('shows the room code and that it is waiting for others', () => {
    const html = netStatusHtml(base);
    expect(html).toContain('ABCD');
    expect(html).toContain('他の人を待っています');
    expect(html).toContain('1/8');
    expect(html).not.toContain('接続中');
  });
  it('names only the first other player and counts the rest', () => {
    const html = netStatusHtml({ ...base, others: [{ name: '<拓海>', color: 0x00ff00 }, { name: '涼介', color: 0x0000ff }] });
    expect(html).toContain('&#60;拓海&#62; ほか1人');
    expect(html).not.toContain('涼介');
    expect(html.match(/ns-dot"/g)).toHaveLength(3);
    expect(html).toContain('3/8');
  });
  it('replaces the head count with the race state', () => {
    expect(netStatusHtml({ ...base, race: 'entry' })).toContain('エントリー中');
    expect(netStatusHtml({ ...base, race: 'racing', connected: false })).toContain('対戦中');
    expect(netStatusHtml({ ...base, connected: false })).toContain('（接続中…）');
  });
});
