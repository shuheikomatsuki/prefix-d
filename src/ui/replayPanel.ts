import { formatTime } from '../race/timeAttack';
import { type Replay, type ReplayClock, type ReplayFrame, frameAt, replayDuration, steerLabel } from '../race/replay';
import { escapeHtml, hex } from './html';

/** グラフに出す、いまより前の時間と後の時間 [s] */
const GRAPH_BEFORE = 6;
const GRAPH_AFTER = 2;
/** ハンドルの絵を、いっぱいに切ったときに回す角度 [deg] */
const WHEEL_LOCK_DEG = 200;
/** ← → で飛ぶ時間 [s]（Shift を押しながらなら短く） */
const SKIP_SECONDS = 5;
const STEP_SECONDS = 0.1;

const COLORS = { steer: '#f4f4f4', throttle: '#5fe08a', brake: '#ff5a4f', under: 'rgba(255, 178, 28, 0.35)', grid: 'rgba(255,255,255,0.15)', now: '#ffb21c' };

export interface ReplayPanelHandlers {
  onClose: () => void;
  onCamera: () => void;
  /** 追いかける車を変えた（番号） */
  onFollow: (index: number) => void;
}

/**
 * リプレイの画面: 再生の操作（再生・一時停止・早送り・スロー・シーク）と、
 * 追いかけている車のハンドル・アクセル・ブレーキ・速さ（いまの値と、前後数秒のグラフ）を出す
 */
export class ReplayPanel {
  private readonly root: HTMLDivElement;
  private readonly q = <T extends HTMLElement>(sel: string) => this.root.querySelector<T>(sel)!;
  private replay: Replay | null = null;
  private clock: ReplayClock | null = null;
  private follow = 0;
  private overviewDirty = true;
  private seeking = false;
  private readonly keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(private readonly handlers: ReplayPanelHandlers) {
    this.root = document.createElement('div');
    this.root.id = 'replay';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="rp-top">
        <span class="rp-tag">REPLAY</span>
        <span class="rp-title"></span>
        <span class="spacer"></span>
        <button type="button" class="rp-close">終了<kbd>Esc</kbd></button>
      </div>
      <div class="rp-cars" role="tablist" aria-label="追いかける車"></div>
      <div class="rp-tele">
        <div class="rp-now">
          <div class="rp-speed"><b>0</b><small>km/h</small></div>
          <div class="rp-wheel" aria-hidden="true">
            <svg viewBox="-50 -50 100 100"><circle r="40" fill="none" stroke="currentColor" stroke-width="9"/><path d="M-38 -4 H38 M0 -4 V38" stroke="currentColor" stroke-width="9" fill="none"/><rect x="-4" y="-48" width="8" height="12" fill="#ffb21c"/></svg>
          </div>
          <div class="rp-steer"><span class="rp-steer-text">まっすぐ</span><span class="rp-under">アンダー</span></div>
          <div class="rp-pedals">
            <div class="rp-pedal brk"><i></i><span>ブレーキ</span></div>
            <div class="rp-pedal thr"><i></i><span>アクセル</span></div>
          </div>
        </div>
        <canvas class="rp-graph"></canvas>
        <div class="rp-legend"><span class="s">ハンドル（上が左）</span><span class="t">アクセル</span><span class="b">ブレーキ</span><span class="u">アンダーステア</span></div>
        <p class="rp-noinput hidden">この記録には操作の記録がありません（速さだけ）</p>
      </div>
      <div class="rp-bar">
        <div class="rp-seek"><canvas class="rp-overview"></canvas></div>
        <div class="rp-controls">
          <button type="button" class="rp-back" title="5秒戻る（←）">⏪</button>
          <button type="button" class="rp-play primary" title="再生・一時停止（Space）">⏸</button>
          <button type="button" class="rp-fwd" title="5秒進む（→）">⏩</button>
          <button type="button" class="rp-speedbtn" title="再生の速さ（↑ ↓）">×1</button>
          <span class="rp-time">0:00.00 / 0:00.00</span>
          <span class="spacer"></span>
          <button type="button" class="rp-camera" title="カメラ（C）"><span class="rp-camname">カメラ</span><kbd>C</kbd></button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    const tap = (sel: string, run: () => void) => {
      const b = this.q<HTMLButtonElement>(sel);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', run);
    };
    tap('.rp-close', () => this.handlers.onClose());
    tap('.rp-play', () => this.clock?.toggle());
    tap('.rp-back', () => this.skip(-SKIP_SECONDS));
    tap('.rp-fwd', () => this.skip(SKIP_SECONDS));
    tap('.rp-camera', () => this.handlers.onCamera());
    tap('.rp-speedbtn', () => {
      const c = this.clock;
      if (!c) return;
      // 押すたびに速くし、いちばん速い次はいちばん遅く
      if (c.speed >= 4) c.setSpeed(0.25);
      else c.changeSpeed(1);
    });
    this.q('.rp-cars').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-index]');
      if (b) this.setFollow(Number(b.dataset.index), true);
    });
    const seekCanvas = this.q<HTMLCanvasElement>('.rp-overview');
    const seekTo = (e: PointerEvent) => {
      const c = this.clock;
      if (!c) return;
      const r = seekCanvas.getBoundingClientRect();
      c.seek(((e.clientX - r.left) / Math.max(1, r.width)) * c.duration);
    };
    seekCanvas.addEventListener('pointerdown', (e) => {
      this.seeking = true;
      seekCanvas.setPointerCapture(e.pointerId);
      seekTo(e);
    });
    seekCanvas.addEventListener('pointermove', (e) => this.seeking && seekTo(e));
    const stop = () => (this.seeking = false);
    seekCanvas.addEventListener('pointerup', stop);
    seekCanvas.addEventListener('pointercancel', stop);
    window.addEventListener('resize', () => (this.overviewDirty = true));
  }

  get isOpen(): boolean {
    return this.replay !== null;
  }

  /** カメラのボタンに、いまの視点の名前を出す */
  setCameraName(name: string): void {
    this.q<HTMLElement>('.rp-camname').textContent = name;
  }

  get following(): number {
    return this.follow;
  }

  open(replay: Replay, clock: ReplayClock, follow = 0): void {
    this.replay = replay;
    this.clock = clock;
    this.q('.rp-title').textContent = replay.title;
    this.q('.rp-cars').innerHTML =
      replay.tracks.length > 1
        ? replay.tracks
            .map(
              (t, i) =>
                `<button type="button" role="tab" data-index="${i}"><span class="dot" style="background:${hex(t.color)}"></span>${escapeHtml(t.name)}</button>`,
            )
            .join('') + '<kbd class="rp-tabkey">V</kbd>'
        : '';
    this.root.classList.remove('hidden');
    document.body.classList.add('replaying');
    // メニューや運転のキーより先に受け取る
    window.addEventListener('keydown', this.keyHandler, { capture: true });
    this.overviewDirty = true;
    this.setFollow(follow, false);
  }

  close(): void {
    if (!this.replay) return;
    this.replay = null;
    this.clock = null;
    this.root.classList.add('hidden');
    document.body.classList.remove('replaying');
    window.removeEventListener('keydown', this.keyHandler, { capture: true });
  }

  /** 追いかける車を変える（notify なら呼び出し元に知らせる） */
  setFollow(index: number, notify: boolean): void {
    const n = this.replay?.tracks.length ?? 0;
    if (n === 0) return;
    this.follow = ((index % n) + n) % n;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.rp-cars button')) {
      const on = Number(b.dataset.index) === this.follow;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-selected', String(on));
    }
    const track = this.replay!.tracks[this.follow];
    this.q('.rp-noinput').classList.toggle('hidden', track.inputs.length > 0);
    this.overviewDirty = true;
    if (notify) this.handlers.onFollow(this.follow);
  }

  private skip(seconds: number): void {
    const c = this.clock;
    if (c) c.seek(c.time + seconds);
  }

  private onKey(e: KeyboardEvent): void {
    const c = this.clock;
    if (!c || e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    switch (e.code) {
      case 'Space':
      case 'KeyK':
        if (!e.repeat) c.toggle();
        break;
      case 'ArrowLeft':
      case 'KeyA':
      case 'KeyJ':
        this.skip(e.shiftKey ? -1 : -SKIP_SECONDS);
        break;
      case 'ArrowRight':
      case 'KeyD':
      case 'KeyL':
        this.skip(e.shiftKey ? 1 : SKIP_SECONDS);
        break;
      case 'Comma':
        c.playing = false;
        this.skip(-STEP_SECONDS);
        break;
      case 'Period':
        c.playing = false;
        this.skip(STEP_SECONDS);
        break;
      case 'ArrowUp':
      case 'KeyW':
        c.changeSpeed(1);
        break;
      case 'ArrowDown':
      case 'KeyS':
        c.changeSpeed(-1);
        break;
      case 'Home':
        c.seek(0);
        break;
      case 'KeyV':
      case 'Tab':
        this.setFollow(this.follow + (e.shiftKey ? -1 : 1), true);
        break;
      case 'KeyC':
        this.handlers.onCamera();
        break;
      case 'Escape':
      case 'KeyQ':
        if (!e.repeat) this.handlers.onClose();
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (!e.code.startsWith('F') && e.code !== 'KeyM') {
      // リプレイの間は、他の操作（マップを替える・レースを始めるなど）をさせない（ミュートとファンクションキーは通す）
      e.stopImmediatePropagation();
    }
  }

  /** 描画のたびに呼ぶ（clock を進めた後） */
  update(): void {
    const replay = this.replay;
    const c = this.clock;
    if (!replay || !c) return;
    const track = replay.tracks[this.follow];
    const f = frameAt(track, c.time);
    this.q('.rp-play').textContent = c.playing ? '⏸' : '▶';
    this.q('.rp-speedbtn').textContent = `×${c.speed}`;
    this.q('.rp-time').textContent = `${formatTime(c.time)} / ${formatTime(c.duration)}`;
    if (f) this.showNow(f);
    this.drawGraph(c.time);
    this.drawOverview(c.time);
  }

  private showNow(f: ReplayFrame): void {
    this.q('.rp-speed b').textContent = String(Math.round(Math.abs(f.speed) * 3.6));
    this.q<HTMLElement>('.rp-wheel svg').style.transform = `rotate(${-f.steer * WHEEL_LOCK_DEG}deg)`;
    this.q('.rp-steer-text').textContent = f.hasInputs ? steerLabel(f.steer) : '—';
    this.q('.rp-under').classList.toggle('on', f.understeer > 0.15);
    this.q<HTMLElement>('.rp-pedal.thr i').style.height = `${Math.round(f.throttle * 100)}%`;
    this.q<HTMLElement>('.rp-pedal.brk i').style.height = `${Math.round(f.brake * 100)}%`;
  }

  /** canvas の大きさを表示の大きさに合わせる（変わっていれば true） */
  private fit(canvas: HTMLCanvasElement): boolean {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  }

  /** いまの前後数秒の、ハンドル・アクセル・ブレーキのグラフ */
  private drawGraph(now: number): void {
    const canvas = this.q<HTMLCanvasElement>('.rp-graph');
    this.fit(canvas);
    const ctx = canvas.getContext('2d');
    const track = this.replay?.tracks[this.follow];
    if (!ctx || !track) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    const t0 = now - GRAPH_BEFORE;
    const span = GRAPH_BEFORE + GRAPH_AFTER;
    const xOf = (t: number) => ((t - t0) / span) * w;
    // 上半分がハンドル、その下にアクセル、いちばん下にブレーキ
    const steerTop = 0;
    const steerH = h * 0.5;
    const thrTop = h * 0.54;
    const pedalH = h * 0.2;
    const brkTop = h * 0.78;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, thrTop, w, pedalH);
    ctx.fillRect(0, brkTop, w, pedalH);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, steerTop + steerH / 2);
    ctx.lineTo(w, steerTop + steerH / 2);
    // 1秒ごとの目盛り
    for (let s = Math.ceil(t0); s <= t0 + span; s++) {
      ctx.moveTo(xOf(s), 0);
      ctx.lineTo(xOf(s), h);
    }
    ctx.stroke();
    const columns = Math.min(w, 400);
    const frames: (ReplayFrame | null)[] = [];
    for (let i = 0; i <= columns; i++) {
      const t = t0 + (span * i) / columns;
      frames.push(t < 0 || t > (this.clock?.duration ?? 0) ? null : frameAt(track, t));
    }
    const colX = (i: number) => (i / columns) * w;
    // アンダーステアの所に色を付ける
    ctx.fillStyle = COLORS.under;
    frames.forEach((f, i) => {
      if (f && f.understeer > 0.05) ctx.fillRect(colX(i), steerTop, w / columns + 1, steerH);
    });
    const area = (top: number, height: number, key: 'throttle' | 'brake', color: string) => {
      ctx.fillStyle = color;
      frames.forEach((f, i) => {
        if (!f || f[key] <= 0) return;
        const v = f[key] * height;
        ctx.fillRect(colX(i), top + height - v, w / columns + 1, v);
      });
    };
    area(thrTop, pedalH, 'throttle', COLORS.throttle);
    area(brkTop, pedalH, 'brake', COLORS.brake);
    ctx.strokeStyle = COLORS.steer;
    ctx.lineWidth = Math.max(1.5, h / 70);
    ctx.beginPath();
    let pen = false;
    frames.forEach((f, i) => {
      if (!f) {
        pen = false;
        return;
      }
      // 左（+）を上に
      const y = steerTop + steerH / 2 - f.steer * (steerH / 2) * 0.92;
      if (pen) ctx.lineTo(colX(i), y);
      else ctx.moveTo(colX(i), y);
      pen = true;
    });
    ctx.stroke();
    ctx.strokeStyle = COLORS.now;
    ctx.lineWidth = Math.max(1.5, h / 80);
    ctx.beginPath();
    ctx.moveTo(xOf(now), 0);
    ctx.lineTo(xOf(now), h);
    ctx.stroke();
  }

  /** シークバー: 走り全体のアクセル（上）・ブレーキ（下）と、周回の目印・いまの位置 */
  private drawOverview(now: number): void {
    const canvas = this.q<HTMLCanvasElement>('.rp-overview');
    const resized = this.fit(canvas);
    const ctx = canvas.getContext('2d');
    const replay = this.replay;
    if (!ctx || !replay) return;
    const { width: w, height: h } = canvas;
    const duration = Math.max(0.001, replayDuration(replay));
    if (resized || this.overviewDirty || !this.overviewCache || this.overviewCache.width !== w) {
      this.overviewDirty = false;
      this.overviewCache = this.renderOverview(replay, w, h, duration);
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.overviewCache, 0, 0);
    const x = (now / duration) * w;
    ctx.fillStyle = COLORS.now;
    ctx.fillRect(x - Math.max(1, h / 16), 0, Math.max(2, h / 8), h);
  }

  private overviewCache: HTMLCanvasElement | null = null;

  private renderOverview(replay: Replay, w: number, h: number, duration: number): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, 0, w, h);
    const track = replay.tracks[this.follow];
    if (track.inputs.length > 0) {
      for (let x = 0; x < w; x++) {
        const f = frameAt(track, ((x + 0.5) / w) * duration);
        if (!f || f.ended) continue;
        if (f.throttle > 0) {
          ctx.fillStyle = COLORS.throttle;
          ctx.globalAlpha = 0.25 + 0.75 * f.throttle;
          ctx.fillRect(x, 0, 1, h * 0.48);
        }
        if (f.brake > 0) {
          ctx.fillStyle = COLORS.brake;
          ctx.globalAlpha = 0.25 + 0.75 * f.brake;
          ctx.fillRect(x, h * 0.52, 1, h * 0.48);
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(h * 0.42)}px sans-serif`;
    ctx.textBaseline = 'top';
    for (const m of replay.marks) {
      const x = (m.time / duration) * w;
      ctx.fillRect(x - 1, 0, 2, h);
      const tw = ctx.measureText(m.label).width;
      ctx.fillText(m.label, Math.min(w - tw - 2, x + 3), 2);
    }
    return out;
  }
}
