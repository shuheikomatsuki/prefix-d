import { type MirrorRegion, centeredRegion } from '../render/mirrors';

/** ミラーを置ける範囲（画面のいちばん上の真ん中） */
export function measureMirrorRegion(): MirrorRegion {
  const w = window.innerWidth;
  // 縦向き: 横いっぱいに。上のボタン・周回・地図などはミラーの下へずらす（--top-shift）
  if (window.innerHeight > w) return { left: 8, right: w - 8, top: 8 };
  // 横向き: 左上のボタンと右上の地図を避けて、真ん中に左右対称に（操作説明・周回・速度はミラーの下や別の場所へずらす）
  let left = 8;
  let right = w - 8;
  for (const id of ['touch-top', 'minimap']) {
    const r = document.getElementById(id)?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0 || r.top > 80) continue;
    if ((r.left + r.right) / 2 < w / 2) left = Math.max(left, r.right + 10);
    else right = Math.min(right, r.left - 10);
  }
  return centeredRegion(w, left, right, 8);
}
