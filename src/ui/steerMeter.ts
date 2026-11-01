import { steerLabel } from '../race/replay';

/**
 * 走っている間に、ハンドルの切れ具合と、その速さでタイヤが曲がれる限界（これより切るとアンダーステア）を出すメーター。
 * 高速では限界がとても小さい（90 km/h で目いっぱいの 6% ほど）ので、小さな角度を広げて見せる（平方根の目盛り）
 */

/** メーターに出すもの */
export interface SteerMeterView {
  /** ハンドルの位置（-1..1。正で左。目盛りは平方根） */
  pos: number;
  /** 限界の位置（0..1。左右に同じだけ） */
  limit: number;
  /** 限界を超えて、はっきりアンダーステアになっているか（わずかに超えただけでは false） */
  over: boolean;
  /** 「左 12%」「まっすぐ」 */
  label: string;
}

/** 角度（最大舵角に対する割合）をメーターの位置にする */
export function meterScale(fraction: number): number {
  const f = Math.min(1, Math.abs(fraction));
  return Math.sign(fraction) * Math.sqrt(f);
}

/** アンダーステアの度合い（0..1）がこれ以上なら、アンダーとして色を変える（リプレイの「アンダー」と同じ） */
export const METER_UNDERSTEER = 0.15;

/** steerAngle: いまの切れ角、grip: 限界の切れ角、maxSteer: 最大舵角 [rad]、understeer: アンダーステアの度合い（0..1） */
export function steerMeterView(steerAngle: number, grip: number, maxSteer: number, understeer: number): SteerMeterView {
  const fraction = steerAngle / maxSteer;
  return {
    pos: meterScale(fraction),
    limit: meterScale(Math.min(grip, maxSteer) / maxSteer),
    // 限界をわずかに超えただけ（ほとんど損しない）では色を変えない
    over: understeer >= METER_UNDERSTEER,
    label: steerLabel(fraction),
  };
}

const STEER_METER_KEY = 'car-game:steer-meter';

/** ハンドルのメーターを出すか（保存した設定。最初は出す） */
export function loadSteerMeter(): boolean {
  try {
    return localStorage.getItem(STEER_METER_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveSteerMeter(on: boolean): void {
  try {
    localStorage.setItem(STEER_METER_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても、このページを開いている間は効く
  }
}

export class SteerMeter {
  private readonly root: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly text: HTMLElement;
  private shownValue = loadSteerMeter();
  private last = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'steer-meter';
    this.root.innerHTML = `
      <div class="sm-track"><i class="sm-zone"></i><i class="sm-fill"></i><i class="sm-center"></i></div>
      <div class="sm-text"></div>`;
    parent.appendChild(this.root);
    this.zone = this.root.querySelector('.sm-zone')!;
    this.fill = this.root.querySelector('.sm-fill')!;
    this.text = this.root.querySelector('.sm-text')!;
    this.root.classList.toggle('hidden', !this.shownValue);
  }

  get shown(): boolean {
    return this.shownValue;
  }

  set shown(on: boolean) {
    this.shownValue = on;
    this.root.classList.toggle('hidden', !on);
    saveSteerMeter(on);
  }

  update(steerAngle: number, grip: number, maxSteer: number, understeer: number): void {
    if (!this.shownValue) return;
    const v = steerMeterView(steerAngle, grip, maxSteer, understeer);
    // 画面では左が左（pos が正 = 左 = バーの左側）
    const key = `${v.pos.toFixed(3)}|${v.limit.toFixed(3)}|${v.over}|${v.label}`;
    if (key === this.last) return;
    this.last = key;
    this.zone.style.left = `${50 - v.limit * 50}%`;
    this.zone.style.width = `${v.limit * 100}%`;
    this.fill.style.left = `${50 - Math.max(0, v.pos) * 50}%`;
    this.fill.style.width = `${Math.abs(v.pos) * 50}%`;
    this.root.classList.toggle('over', v.over);
    this.text.textContent = v.over ? `${v.label}・アンダー` : v.label;
  }
}
