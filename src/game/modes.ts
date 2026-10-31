/** レースの種類（タイムアタック・NPC 対戦・ライバルとのバトル・部屋のみんなとのオンライン対戦） */
export type RaceMode = 'timeAttack' | 'npc' | 'battle' | 'online';
/** ライバルとのバトルのルール: 横に並んでスタート・先行後追い（自分が先行から／後追いから） */
export type BattleRule = 'side' | 'leadFirst' | 'chaseFirst';

export const BATTLE_RULES: readonly { id: BattleRule; label: string; note: string }[] = [
  { id: 'side', label: '横に並んでスタート', note: '先にゴールしたほうの勝ち' },
  { id: 'leadFirst', label: '先行後追い（自分が先行）', note: 'サドンデス方式' },
  { id: 'chaseFirst', label: '先行後追い（自分が後追い）', note: 'サドンデス方式' },
];

/** NPC 対戦の NPC の台数 */
export const NPC_COUNT = 3;
