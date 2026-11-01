import type { SectionGaps } from '../race/sections';
import { escapeHtml } from './html';

/** バトルの結果に添える、区間ごとのタイム差（地図に描く中心線と一緒に渡す） */
export interface SectionReport {
  gaps: SectionGaps;
  /** paths[i] はコースの i 番目の区間の中心線 */
  paths: { x: number; z: number }[][];
}

const LOST = '#ff6b5a';
const GAINED = '#5fe08a';
const EVEN = '#e9e6dc';
const UNKNOWN = 'rgba(255, 255, 255, 0.25)';

/** 差を「+1.24」「−0.50」のように書く（正なら自分が遅い） */
function signed(gap: number): string {
  return `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(2)}`;
}

/** 差の色。0.05 秒より小さい差は互角 */
function gapColor(gap: number | null): string {
  if (gap === null) return UNKNOWN;
  if (Math.abs(gap) < 0.05) return EVEN;
  return gap > 0 ? LOST : GAINED;
}

/** 区間ごとの差の一覧と、どこで離されたか・勝ったかの一言（描画に依存しない HTML） */
export function sectionReportHtml(g: SectionGaps, rival: string): string {
  if (g.gaps.every((x) => x === null)) return '';
  const cells = g.gaps
    .map((gap, i) => `<li style="--c:${gapColor(gap)}"><span>区間${i + 1}</span><b>${gap === null ? '—' : signed(gap)}</b></li>`)
    .join('');
  const lines: string[] = [];
  // 比べられた区間の合計で遅れていれば、詰めどころとして伝える
  const behind = g.gaps.reduce<number>((sum, x) => sum + (x ?? 0), 0) > 0;
  if (g.worst !== null) lines.push(`いちばん離されたのは<b>区間${g.worst + 1}</b>（${signed(g.gaps[g.worst]!)}秒）。${behind ? 'ここを詰めれば差が縮まる。' : ''}`);
  if (g.best !== null) lines.push(`<b>区間${g.best + 1}</b>は${escapeHtml(rival)}より${Math.abs(g.gaps[g.best]!).toFixed(2)}秒速かった。`);
  return `<div class="sections">
    <p class="note">区間ごとのタイム差（＋は${escapeHtml(rival)}より遅い）</p>
    <canvas class="section-map"></canvas>
    <ol class="section-gaps">${cells}</ol>
    ${lines.map((l) => `<p class="section-line">${l}</p>`).join('')}
  </div>`;
}

/** 区間を色分けしたコースの地図を描く（赤は離された、緑は速かった区間） */
export function drawSectionMap(canvas: HTMLCanvasElement, report: SectionReport): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const g = canvas.getContext('2d');
  if (!g || w < 2 || h < 2) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * ratio);
  canvas.height = Math.round(h * ratio);
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.clearRect(0, 0, w, h);
  const all = report.paths.flat();
  if (!all.length) return;
  const xs = all.map((p) => p.x);
  const zs = all.map((p) => p.z);
  const minX = Math.min(...xs);
  const minZ = Math.min(...zs);
  const spanX = Math.max(...xs) - minX || 1;
  const spanZ = Math.max(...zs) - minZ || 1;
  const pad = 14;
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanZ);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanZ * scale) / 2;
  // ゲームの地図と同じ向き（上から見て、x は右、z は下）
  const at = (p: { x: number; z: number }): [number, number] => [ox + (p.x - minX) * scale, oy + (p.z - minZ) * scale];
  const line = (pts: { x: number; z: number }[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))));
    g.stroke();
  };
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  g.lineWidth = 8;
  report.paths.forEach(line);
  g.lineWidth = 4;
  report.paths.forEach((pts, i) => {
    g.strokeStyle = gapColor(report.gaps.gaps[i]);
    line(pts);
  });
  // 区間の番号（区間の真ん中に）
  g.font = 'bold 11px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  report.paths.forEach((pts, i) => {
    const [x, y] = at(pts[Math.floor(pts.length / 2)]);
    g.fillStyle = 'rgba(0, 0, 0, 0.75)';
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.fillText(String(i + 1), x, y + 0.5);
  });
  // スタート
  const [sx, sy] = at(report.paths[0][0]);
  g.fillStyle = '#fff';
  g.strokeStyle = '#ff4a1c';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(sx, sy, 4.5, 0, Math.PI * 2);
  g.fill();
  g.stroke();
}
