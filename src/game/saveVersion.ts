/**
 * このブラウザに残したデータの版。データの形や意味を変えるときは SAVE_VERSION を上げ、
 * MIGRATIONS に「前の版から次の版へ」直す手順を足す。起動のたびに、古い版のデータを今の版まで順に直す。
 *
 * 例: あとから「手に入れた車だけ使える」ようにするなら、手に入れた車を「持っている車の一覧」として保存し、
 * 一覧にない車は使えないことにする。昔から遊んでいる人のデータには一覧がないので、何もしなくても
 * 最初の車だけになる（全部の車を配るなど、特別に扱うときはここに手順を足す）。
 * ただしブラウザのデータはその人が書き換えられるので、ずるを確実に防ぐにはサーバーで持つ必要がある。
 */

export const SAVE_VERSION = 3;
const VERSION_KEY = 'car-game:save-version';

type SaveStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

/** MIGRATIONS[n] は、版 n のデータを版 n + 1 に直す（版 0 はこの仕組みを入れる前のデータ） */
const MIGRATIONS: readonly ((storage: SaveStorage) => void)[] = [
  // 0 → 1: 版を記録し始めただけ。データはそのまま使える
  () => {},
  // 1 → 2: タイムアタックの記録とランキングを、コースの形の版ごとに分けた（src/map/courseRevision.ts）。
  // 前の記録はどの形のコースで走ったかわからない（ゴーストが道路の外を走る）ので消す
  (storage) => {
    const old = ['car-game:time-attack:v1:', 'car-game:uploaded:v1:', 'car-game:my-entry:v1:'];
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i) ?? '');
    for (const k of keys) if (old.some((p) => k.startsWith(p))) storage.removeItem(k);
  },
  // 2 → 3: ライバルに勝った記録（WIN）を、得意コースと条件を満たした勝ちだけ数えるようにした。
  // 前の記録は条件を満たしていたかわからないので消す
  (storage) => storage.removeItem('car-game:beaten-rivals'),
];

/** 保存されている版（記録がなければ 0） */
export function savedVersion(storage: Pick<Storage, 'getItem'>): number {
  const v = Number(storage.getItem(VERSION_KEY));
  return Number.isInteger(v) && v > 0 ? v : 0;
}

/**
 * 古い版のデータを今の版まで直して、直す前の版を返す（localStorage を使えなければ null）。
 * 新しい版のゲームで保存したデータを古いゲームで開いたとき（版が今より大きいとき）は何もしない
 */
export function migrateSaveData(storage: SaveStorage | null = safeLocalStorage(), migrations = MIGRATIONS): number | null {
  if (!storage) return null;
  const from = savedVersion(storage);
  const target = migrations.length;
  if (from >= target) return from;
  try {
    for (let v = from; v < target; v++) migrations[v](storage);
    storage.setItem(VERSION_KEY, String(target));
  } catch {
    // 保存できなくても遊べる（次に開いたときにもう一度直す）
  }
  return from;
}

function safeLocalStorage(): SaveStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
