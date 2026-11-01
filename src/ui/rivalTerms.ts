import { TIMES_OF_DAY, WEATHERS } from '../game/environment';
import { NPC_LEVELS } from '../race/npcDriver';
import type { MissedTerm, Rival } from '../race/rivals';

const timeLabel = (id: string) => TIMES_OF_DAY.find((t) => t.id === id)?.label ?? id;
const weatherLabel = (id: string) => WEATHERS.find((w) => w.id === id)?.label ?? id;

/** WIN として記録される条件（「秋名（ダウンヒル）・夜・雨・ラフプレーあり」） */
export function winTermsText(rival: Rival, mapName: (id: string) => string): string {
  return [
    mapName(rival.course),
    ...(rival.conditions ? [`${timeLabel(rival.conditions.time)}・${weatherLabel(rival.conditions.weather)}`] : []),
    ...(rival.rough ? ['ラフプレーあり'] : []),
  ].join('・');
}

/** 満たしていない WIN の条件の書き方（「得意コース以外・天気が雨でない」） */
export function missedTermsText(rival: Rival, missed: readonly MissedTerm[]): string {
  const text: Record<MissedTerm, string> = {
    course: '得意コース以外',
    time: `時間帯が${timeLabel(rival.conditions?.time ?? '')}でない`,
    weather: `天気が${weatherLabel(rival.conditions?.weather ?? '')}でない`,
    rough: 'ラフプレーなし',
  };
  return missed.map((m) => text[m]).join('・');
}

/** まだ解放されていないライバルの、解放の条件（「初級のライバルを全員倒すと解放（残り: 池谷浩一郎）」） */
export function unlockText(rival: Rival, remaining: readonly Rival[]): string {
  const below = NPC_LEVELS.slice(0, Math.max(0, NPC_LEVELS.findIndex((l) => l.id === rival.level)));
  const levels = below.length > 1 ? `${below[0].label}〜${below[below.length - 1].label}` : (below[0]?.label ?? '');
  return `${levels}のライバルを全員倒すと解放（残り: ${remaining.map((r) => r.name).join('、')}）`;
}
