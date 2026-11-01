import type { Course } from '../race/course';
import { DIR_OFFSET, type MapDefinition, parseMap } from '../map/tilemap';
import { type MinimapMode, loadMinimapMode, localTransform } from './minimapView';

interface Point {
  x: number;
  z: number;
}

/** 周りだけ出すときに、遠い道を飛ばせるよう、道を短い区切りに分けて範囲を持たせたもの */
interface Chunk {
  points: Point[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MinimapMarker {
  x: number;
  z: number;
  color: string;
  /** 自分の車は大きく、向きの分かる三角で描く */
  yaw?: number;
  size?: number;
}

/**
 * 上から見た小さな地図。自分・ゴースト・他の車の位置を点で出す。
 * マップ全体を出すか、自分の周りだけを出すか（北が上・進行方向が上）を切り替えられる
 */
export class Minimap {
  /** 地図の表示（設定で切り替える） */
  private modeValue: MinimapMode = loadMinimapMode();
  private def: MapDefinition | null = null;
  private course: Course | null = null;
  /** 周りだけ出すときの道・スタートとゴールの線 */
  private chunks: Chunk[] = [];
  private lines: { a: Point; b: Point }[] = [];
  private roadWidth = 10;
  private size = 0;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** コースの形は変わらないので、一度だけ描いておいて毎フレーム貼る */
  private background: HTMLCanvasElement | null = null;
  private scale = 1;
  private offsetX = 0;
  private offsetZ = 0;
  private pixelRatio = 1;

  /** onResize: 地図の高さ [CSS px] が変わったとき（隠したときは 0）。下に並べる表示をずらすのに使う */
  constructor(
    private readonly container: HTMLElement,
    private readonly onResize: (height: number) => void = () => {},
  ) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
    container.appendChild(this.canvas);
  }

  get mode(): MinimapMode {
    return this.modeValue;
  }

  set mode(mode: MinimapMode) {
    this.modeValue = mode;
    if (this.def) this.setMap(this.def, this.course);
  }

  /** 地図を隠す */
  hide(): void {
    this.container.classList.add('hidden');
    this.background = null;
    this.chunks = [];
    this.onResize(0);
  }

  /**
   * マップの地図を出す。レース用のコースはその中心線とスタート・ゴールの線、
   * タイルの街は道路のつながりを描く
   */
  setMap(def: MapDefinition, course: Course | null): void {
    this.container.classList.remove('hidden');
    this.background = null;
    this.chunks = [];
    this.def = def;
    this.course = course;
    const paths: { points: Point[]; closed: boolean }[] = [];
    if (course) {
      // 中心線をたどった点の範囲に合わせる
      const step = 4;
      paths.push({ points: Array.from({ length: Math.ceil(course.length / step) + 1 }, (_, i) => course.pointAt(Math.min(i * step, course.length))), closed: course.closed });
    } else {
      // 道路のタイルの中心どうしを、つながっている向き（東・南）に結ぶ
      const map = parseMap(def);
      const ts = def.tileSize;
      for (const t of map.tiles) {
        if (t.kind !== 'road') continue;
        const at = { x: t.col * ts, z: t.row * ts };
        const ends = t.connections.filter((d) => d === 'E' || d === 'S').map((d) => ({ x: at.x + DIR_OFFSET[d].dc * ts, z: at.z + DIR_OFFSET[d].dr * ts }));
        if (t.connections.length === 0) paths.push({ points: [at, at], closed: false });
        for (const e of ends) paths.push({ points: [at, e], closed: false });
      }
    }
    if (paths.length === 0) return this.hide();
    if (this.modeValue !== 'overview') return this.setLocal(def, course, paths);
    const xs = paths.flatMap((p) => p.points.map((q) => q.x));
    const zs = paths.flatMap((p) => p.points.map((q) => q.z));
    const margin = def.roadWidth;
    const minX = Math.min(...xs) - margin;
    const minZ = Math.min(...zs) - margin;
    const worldW = Math.max(...xs) + margin - minX;
    const worldH = Math.max(...zs) + margin - minZ;
    const box = this.container.clientWidth || 160;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pad = 6;
    const fit = (box - pad * 2) / Math.max(worldW, worldH);
    const cssW = Math.round(worldW * fit + pad * 2);
    const cssH = Math.round(worldH * fit + pad * 2);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = cssW * this.pixelRatio;
    this.canvas.height = cssH * this.pixelRatio;
    this.scale = fit * this.pixelRatio;
    this.offsetX = (pad - minX * fit) * this.pixelRatio;
    this.offsetZ = (pad - minZ * fit) * this.pixelRatio;
    this.onResize(cssH);

    const bg = document.createElement('canvas');
    bg.width = this.canvas.width;
    bg.height = this.canvas.height;
    const g = bg.getContext('2d')!;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const stroke = (color: string, width: number) => {
      for (const { points, closed } of paths) {
        g.beginPath();
        points.forEach((p, i) => {
          const [x, z] = this.toCanvas(p.x, p.z);
          if (i === 0) g.moveTo(x, z);
          else g.lineTo(x, z);
        });
        if (closed) g.closePath();
        g.strokeStyle = color;
        g.lineWidth = width;
        g.stroke();
      }
    };
    stroke('rgba(255, 255, 255, 0.9)', Math.max(4 * this.pixelRatio, def.roadWidth * this.scale + 2 * this.pixelRatio));
    stroke('#4a4e57', Math.max(2.5 * this.pixelRatio, def.roadWidth * this.scale));

    // スタートラインとゴールライン
    for (const line of course ? (course.closed ? [course.line] : [course.line, course.finishLine]) : []) {
      const lx = Math.cos(line.yaw);
      const lz = -Math.sin(line.yaw);
      const w = def.roadWidth / 2 + 2;
      const [ax, az] = this.toCanvas(line.x + lx * w, line.z + lz * w);
      const [bx, bz] = this.toCanvas(line.x - lx * w, line.z - lz * w);
      g.beginPath();
      g.moveTo(ax, az);
      g.lineTo(bx, bz);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2 * this.pixelRatio;
      g.stroke();
    }
    this.background = bg;
  }

  /** 周りだけ出す: 一辺が地図の枠の幅の正方形。道は毎フレーム、近くの区切りだけ描く */
  private setLocal(def: MapDefinition, course: Course | null, paths: { points: Point[]; closed: boolean }[]): void {
    const box = this.container.clientWidth || 160;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.size = box;
    this.canvas.style.width = `${box}px`;
    this.canvas.style.height = `${box}px`;
    this.canvas.width = box * this.pixelRatio;
    this.canvas.height = box * this.pixelRatio;
    this.roadWidth = def.roadWidth;
    this.onResize(box);
    const per = 40;
    for (const { points, closed } of paths) {
      const all = closed && points.length > 2 ? [...points, points[0]] : points;
      for (let i = 0; i < all.length - 1; i += per) {
        const part = all.slice(i, i + per + 1);
        const xs = part.map((p) => p.x);
        const zs = part.map((p) => p.z);
        this.chunks.push({ points: part, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
      }
    }
    this.lines = [];
    for (const line of course ? (course.closed ? [course.line] : [course.line, course.finishLine]) : []) {
      const lx = Math.cos(line.yaw);
      const lz = -Math.sin(line.yaw);
      const w = def.roadWidth / 2 + 2;
      this.lines.push({ a: { x: line.x + lx * w, z: line.z + lz * w }, b: { x: line.x - lx * w, z: line.z - lz * w } });
    }
  }

  private toCanvas(x: number, z: number): [number, number] {
    return [x * this.scale + this.offsetX, z * this.scale + this.offsetZ];
  }

  /** 車の位置を描く。後ろの要素ほど上に重なる */
  draw(markers: MinimapMarker[]): void {
    if (this.modeValue !== 'overview') return this.drawLocal(markers);
    if (!this.background) return;
    const g = this.ctx;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.background, 0, 0);
    const pr = this.pixelRatio;
    for (const m of markers) {
      const [x, y] = this.toCanvas(m.x, m.z);
      const r = (m.size ?? 4) * pr;
      g.fillStyle = m.color;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.lineWidth = 1.5 * pr;
      g.beginPath();
      if (m.yaw === undefined) {
        g.arc(x, y, r, 0, Math.PI * 2);
      } else {
        // 前方 (sin yaw, cos yaw)。キャンバスは +Z が下なのでそのまま使える
        const fx = Math.sin(m.yaw);
        const fz = Math.cos(m.yaw);
        g.moveTo(x + fx * r * 1.6, y + fz * r * 1.6);
        g.lineTo(x - fx * r + fz * r, y - fz * r - fx * r);
        g.lineTo(x - fx * r - fz * r, y - fz * r + fx * r);
        g.closePath();
      }
      g.fill();
      g.stroke();
    }
  }

  /** 周りだけの地図を描く。自分（yaw のある印）を基準にする */
  private drawLocal(markers: MinimapMarker[]): void {
    if (this.chunks.length === 0) return;
    const me = markers.find((m) => m.yaw !== undefined);
    if (!me) return;
    const mode = this.modeValue === 'heading' ? 'heading' : 'north';
    const pr = this.pixelRatio;
    const t = localTransform(mode, me.x, me.z, me.yaw!, this.size);
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const [a, b, c, d, e, f] = t.matrix;
    g.setTransform(a * pr, b * pr, c * pr, d * pr, e * pr, f * pr);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const r = t.radius;
    const near = this.chunks.filter((k) => k.maxX > me.x - r && k.minX < me.x + r && k.maxZ > me.z - r && k.minZ < me.z + r);
    // 線の太さは世界の長さで指定する（setTransform で拡大される）
    const px = 1 / t.scale;
    const stroke = (color: string, width: number) => {
      g.beginPath();
      for (const k of near) {
        k.points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.z) : g.lineTo(p.x, p.z)));
      }
      g.strokeStyle = color;
      g.lineWidth = width;
      g.stroke();
    };
    stroke('rgba(255, 255, 255, 0.9)', Math.max(5 * px, this.roadWidth + 3 * px));
    stroke('#4a4e57', Math.max(3 * px, this.roadWidth));
    g.beginPath();
    for (const l of this.lines) {
      g.moveTo(l.a.x, l.a.z);
      g.lineTo(l.b.x, l.b.z);
    }
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.5 * px;
    g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const m of markers) {
      const [mx, my] = t.toMap(m.x, m.z);
      const x = mx * pr;
      const y = my * pr;
      const size = (m.size ?? 4) * pr;
      g.fillStyle = m.color;
      g.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      g.lineWidth = 1.5 * pr;
      g.beginPath();
      if (m.yaw === undefined) {
        g.arc(x, y, size, 0, Math.PI * 2);
      } else {
        // 回す地図では自分は常に上向き。北が上の地図では向きのとおり
        const yawOnMap = mode === 'heading' ? Math.PI : m.yaw;
        const fx = Math.sin(yawOnMap);
        const fz = Math.cos(yawOnMap);
        g.moveTo(x + fx * size * 1.6, y + fz * size * 1.6);
        g.lineTo(x - fx * size + fz * size, y - fz * size - fx * size);
        g.lineTo(x - fx * size - fz * size, y - fz * size + fx * size);
        g.closePath();
      }
      g.fill();
      g.stroke();
    }
  }
}
