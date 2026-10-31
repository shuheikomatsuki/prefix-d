import { escapeHtml, hex } from './html';

export interface NetStatusView {
  roomCode: string;
  /** つながっていれば true（接続中・再接続中は false） */
  connected: boolean;
  /** 自分の色 */
  selfColor: number;
  /** 部屋の他の人 */
  others: readonly { name: string; color: number }[];
  /** 部屋の対戦の様子（なければ null） */
  race: 'entry' | 'racing' | null;
  maxPlayers: number;
}

/**
 * 右上の部屋の表示（部屋コード・人数・みんなの色）。
 * 人数が増えても大きくならないよう、色の点を一列に並べ、名前は最初の人だけ出す
 */
export function netStatusHtml(v: NetStatusView): string {
  const state = v.connected ? '' : '（接続中…）';
  const dots = [v.selfColor, ...v.others.map((p) => p.color)].map((c) => `<span class="ns-dot" style="background:${hex(c)}"></span>`).join('');
  const who = v.others.length === 0 ? '他の人を待っています' : `${escapeHtml(v.others[0].name)}${v.others.length > 1 ? ` ほか${v.others.length - 1}人` : ''}`;
  // 対戦の様子は、人数の代わりに右上に出す（2行のまま）
  const corner = v.race ? `<span class="ns-race">${v.race === 'entry' ? 'エントリー中' : '対戦中'}</span>` : `<span class="ns-count">${v.others.length + 1}/${v.maxPlayers}</span>`;
  return (
    `<div class="ns-head"><span class="ns-label">ROOM</span> <span class="code">${escapeHtml(v.roomCode)}</span>${state}${corner}</div>` +
    `<div class="ns-who"><span class="ns-dots">${dots}</span><span class="ns-names">${who}</span></div>`
  );
}
