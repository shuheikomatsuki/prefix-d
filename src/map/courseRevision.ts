import type { MapDefinition } from './tilemap';

/**
 * コースの形の版。タイムアタックの記録・ゴースト・ランキングは「コースの id ＋ 形の版」ごとに分ける。
 * コースの形を直すと版が変わり、前の形で走ったゴースト（道路から外れた所を走ってしまう）や
 * 比べられないタイムは使われなくなる。表示名や標識を変えただけなら版は変わらない。
 * 車の動きを大きく変えたときも版を変え、前の動きで走ったタイムと分ける。
 */

/**
 * 車の動き（src/sim/vehicle.ts）を、タイムが比べられないほど変えたときに上げる（コースの形とは別）。
 * 2: ハンドルを限界より多く切るとアンダーステアになる（それまでは限界までしか切れなかった）
 */
const HANDLING_VERSION = 2;

/** 道路の作り方（src/map/road.ts など）を変えて、同じ定義でもコースの形が変わったときに上げる */
const COURSE_BUILDER_VERSION = 1;

/** コースの形から作る、7文字の英数字 */
export function courseRevision(def: MapDefinition): string {
  // 計算で作った座標はブラウザによって最後の桁が違うことがあるので、丸めてから比べる
  const text = JSON.stringify([COURSE_BUILDER_VERSION, HANDLING_VERSION, { ...def, name: undefined, signs: undefined }], (_, v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v,
  );
  // FNV-1a（32bit）
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/** 記録・ランキングを分ける key（「happogahara-1a2b3c4」のような形） */
export function courseKey(def: MapDefinition): string {
  return `${def.id}-${courseRevision(def)}`;
}

/** courseKey から、版を除いたコースの id */
export function courseIdOfKey(key: string): string {
  return key.replace(/-[0-9a-z]{7}$/, '');
}
