/**
 * 画質の設定: 「標準」と「高」。高は影を細かく、遠くまで描く（重い）。
 * はじめはパソコン（マウス）なら高、スマホ・タブレット（指で触る画面）なら標準
 */
export type Quality = 'standard' | 'high';

export const QUALITY_MODES: readonly { id: Quality; label: string }[] = [
  { id: 'standard', label: '標準' },
  { id: 'high', label: '高' },
];

const QUALITY_KEY = 'car-game:quality';

export function defaultQuality(coarsePointer: boolean): Quality {
  return coarsePointer ? 'standard' : 'high';
}

export function loadQuality(): Quality {
  let coarse = false;
  try {
    coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
  } catch {
    coarse = false;
  }
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return QUALITY_MODES.some((m) => m.id === v) ? (v as Quality) : defaultQuality(coarse);
  } catch {
    return defaultQuality(coarse);
  }
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    // 保存できなくても、今回の画質は変わる
  }
}
