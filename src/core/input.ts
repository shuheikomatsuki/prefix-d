import type { DriverInput } from '../sim/vehicle';

const THROTTLE_KEYS = ['KeyW', 'ArrowUp'];
const BRAKE_KEYS = ['KeyS', 'ArrowDown', 'Space'];
const LEFT_KEYS = ['KeyA', 'ArrowLeft'];
const RIGHT_KEYS = ['KeyD', 'ArrowRight'];
const DRIVING_KEYS = new Set([...THROTTLE_KEYS, ...BRAKE_KEYS, ...LEFT_KEYS, ...RIGHT_KEYS]);

/** なめらかなハンドルで、キーを押した瞬間に切る割合（軽く叩けば小さな修正になる） */
export const KEY_STEER_START = 0.3;
/** なめらかなハンドルで、押し続けて目いっぱい（1）に届くまでの時間 [s] */
export const KEY_STEER_RAMP = 0.25;

/**
 * キーを held 秒押し続けたときのハンドルの量（0..1）。
 * smooth なら押した瞬間は少しだけで、押し続けるほど深く切る。そうでなければ押した瞬間から目いっぱい
 */
export function keySteerAmount(held: number, smooth: boolean): number {
  if (!smooth || held >= KEY_STEER_RAMP) return 1;
  return Math.min(1, KEY_STEER_START + ((1 - KEY_STEER_START) * Math.max(0, held)) / KEY_STEER_RAMP);
}

const SMOOTH_STEER_KEY = 'car-game:key-steer-smooth';

/** キーボードのハンドルをなめらかにするか（保存した設定。最初は true） */
export function loadSmoothKeySteer(): boolean {
  try {
    return localStorage.getItem(SMOOTH_STEER_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSmoothKeySteer(on: boolean): void {
  try {
    localStorage.setItem(SMOOTH_STEER_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても、このページを開いている間は効く
  }
}

/** キーボードから運転入力を作る。単発のキー操作（リセット等）は onAction で受け取る */
export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private readonly actions = new Map<string, () => void>();
  /** false の間はキーを無視する（入力欄のある画面を開いているときなど） */
  private enabledValue = true;
  /** 左・右に切り始めた時刻 [ms]（押していなければ null） */
  private leftSince: number | null = null;
  private rightSince: number | null = null;
  /** 押した瞬間は少しだけ切り、押し続けるほど深く切る */
  smoothSteer = true;

  constructor(
    target: Window = window,
    private readonly now: () => number = () => performance.now(),
  ) {
    target.addEventListener('keydown', (e) => {
      if (!this.enabledValue) return;
      if (DRIVING_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.actions.get(e.code)?.();
      this.pressed.add(e.code);
      this.trackSteer();
    });
    target.addEventListener('keyup', (e) => {
      this.pressed.delete(e.code);
      this.trackSteer();
    });
    // ウィンドウ外にフォーカスが移ったらキーを離したことにする
    target.addEventListener('blur', () => this.release());
  }

  set enabled(on: boolean) {
    this.enabledValue = on;
    if (!on) this.release();
  }

  private release(): void {
    this.pressed.clear();
    this.trackSteer();
  }

  /** 左右のキーを押し始めた時刻を覚える（離したら忘れる） */
  private trackSteer(): void {
    const left = LEFT_KEYS.some((k) => this.pressed.has(k));
    const right = RIGHT_KEYS.some((k) => this.pressed.has(k));
    if (!left) this.leftSince = null;
    else this.leftSince ??= this.now();
    if (!right) this.rightSince = null;
    else this.rightSince ??= this.now();
  }

  onAction(code: string, handler: () => void): void {
    this.actions.set(code, handler);
  }

  /** そのキーを押しているか（クラクションのように押している間だけ効く操作） */
  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  read(): DriverInput {
    const any = (keys: string[]) => keys.some((k) => this.pressed.has(k));
    return {
      throttle: any(THROTTLE_KEYS) ? 1 : 0,
      brake: any(BRAKE_KEYS) ? 1 : 0,
      steer: this.steerFrom(this.leftSince) - this.steerFrom(this.rightSince),
    };
  }

  private steerFrom(since: number | null): number {
    return since === null ? 0 : keySteerAmount((this.now() - since) / 1000, this.smoothSteer);
  }
}

/** ゲームパッドの値として無視する小さな傾き */
const STICK_DEADZONE = 0.12;

function applyDeadzone(v: number): number {
  if (Math.abs(v) < STICK_DEADZONE) return 0; // -0 も 0 にそろえる
  return (Math.sign(v) * (Math.abs(v) - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
}

/** ゲームパッドのボタン番号（Standard Gamepad レイアウト） */
export const PAD_BUTTON = {
  /** A / × */
  south: 0,
  /** Y / △ */
  north: 3,
  leftTrigger: 6,
  rightTrigger: 7,
  /** Back / Select */
  select: 8,
  /** Start / Options */
  start: 9,
} as const;

/**
 * Standard レイアウトのゲームパッド状態を運転入力に変換する。
 * 左スティック = ハンドル、右トリガー（または A）= アクセル、左トリガー = ブレーキ。
 */
export function gamepadToDriverInput(axes: readonly number[], buttons: readonly number[]): DriverInput {
  // 少しだけ沈んだまま戻らないトリガーで、勝手にアクセルが入らないように
  const button = (i: number) => ((buttons[i] ?? 0) < 0.1 ? 0 : buttons[i]);
  return {
    throttle: Math.max(button(PAD_BUTTON.rightTrigger), button(PAD_BUTTON.south)),
    brake: button(PAD_BUTTON.leftTrigger),
    // スティックは右が正、ハンドル入力は左が正なので反転する
    steer: applyDeadzone(-(axes[0] ?? 0)),
  };
}

/** 接続中のゲームパッドを読む。ボタンの押した瞬間は onButton で受け取る */
export class GamepadInput {
  private readonly prevButtons = new Map<number, boolean>();
  private readonly actions = new Map<number, () => void>();
  private connected = false;

  onButton(index: number, handler: () => void): void {
    this.actions.set(index, handler);
  }

  /** 毎ステップ呼ぶ。ゲームパッドが無ければ null */
  read(): DriverInput | null {
    const pad = navigator.getGamepads?.().find((p) => p?.connected && p.mapping === 'standard');
    this.connected = !!pad;
    if (!pad) return null;
    const values = pad.buttons.map((b) => b.value);
    pad.buttons.forEach((b, i) => {
      if (b.pressed && !this.prevButtons.get(i)) this.actions.get(i)?.();
      this.prevButtons.set(i, b.pressed);
    });
    return gamepadToDriverInput(pad.axes, values);
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

/** キーボードとゲームパッドの入力を合成する（強いほうを採用） */
export function mergeInputs(a: DriverInput, b: DriverInput | null): DriverInput {
  if (!b) return a;
  return {
    throttle: Math.max(a.throttle, b.throttle),
    brake: Math.max(a.brake, b.brake),
    steer: Math.abs(a.steer) >= Math.abs(b.steer) ? a.steer : b.steer,
  };
}
