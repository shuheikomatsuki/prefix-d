/** 地図の表示: マップ全体・周りだけ（北が上）・周りだけ（進行方向が上。アーケードのように自分の向きで回る） */
export type MinimapMode = 'overview' | 'north' | 'heading';

export const MINIMAP_MODES: readonly { id: MinimapMode; label: string }[] = [
  { id: 'heading', label: '周辺・回転' },
  { id: 'north', label: '周辺・北が上' },
  { id: 'overview', label: '全体' },
];

const MINIMAP_KEY = 'car-game:minimap';

export function loadMinimapMode(): MinimapMode {
  try {
    const v = localStorage.getItem(MINIMAP_KEY);
    return MINIMAP_MODES.some((m) => m.id === v) ? (v as MinimapMode) : 'heading';
  } catch {
    return 'heading';
  }
}

export function saveMinimapMode(mode: MinimapMode): void {
  try {
    localStorage.setItem(MINIMAP_KEY, mode);
  } catch {
    // 保存できなくても動作には影響しない
  }
}

/** 周りだけ出すときに、地図の一辺に入る世界の長さ [m] */
export const LOCAL_SPAN = 460;

/**
 * 周りだけ出すときの、世界 (x, z) → 地図 (px, py) の変換。size は地図の一辺 [px]。
 * 'north' は自分を真ん中に、'heading' は自分の前方 (sin yaw, cos yaw) が地図の上を向くように回して、
 * 前が広く見えるよう自分を少し下に置く
 */
export function localTransform(mode: 'north' | 'heading', x: number, z: number, yaw: number, size: number) {
  const scale = size / LOCAL_SPAN;
  const angle = mode === 'heading' ? Math.PI + yaw : 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cx = size / 2;
  const cy = mode === 'heading' ? size * 0.64 : size / 2;
  return {
    scale,
    /** canvas の setTransform にそのまま渡せる行列 [a, b, c, d, e, f] */
    matrix: [cos * scale, sin * scale, -sin * scale, cos * scale, cx - (cos * x - sin * z) * scale, cy - (sin * x + cos * z) * scale] as const,
    /** 地図の中心から見える範囲の半径 [m]（これより遠い道は描かない） */
    radius: (LOCAL_SPAN / 2) * Math.SQRT2 + 0.14 * LOCAL_SPAN,
    toMap(px: number, pz: number): [number, number] {
      const dx = px - x;
      const dz = pz - z;
      return [cx + (cos * dx - sin * dz) * scale, cy + (sin * dx + cos * dz) * scale];
    },
  };
}
