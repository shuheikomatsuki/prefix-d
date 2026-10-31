import type { RaceState } from '../net/protocol';
import type { BoardChoice } from './rankingPanel';
import { escapeHtml, hex } from './html';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** エントリー画面に出す、部屋の1人分 */
export interface RoomMember {
  id: number;
  name: string;
  car: string;
  color: number;
}

export interface OnlineRaceView {
  race: RaceState;
  selfId: number;
  members: readonly RoomMember[];
  /** コースの名前と、時間帯・天気（「峠（ダウンヒル） ／ 夜・雨」） */
  conditions: string;
}

export interface OnlineRacePanelHandlers {
  /** 準備 OK（その車で出る）・取り消し */
  onReady: (ready: boolean, car: string) => void;
  /** スタートの合図。undecided: まだ準備 OK も見送りも選んでいない人の数（その人は今回は見ているだけになる） */
  onStart: (undecided: number) => void;
  /** 今回は見送る（言い出した人なら対戦をやめる） */
  onLeave: () => void;
  onOpenChange: (open: boolean) => void;
}


/**
 * オンライン対戦のエントリー画面: 言い出した人がコース・時間帯・天気を決めた後、各自が車を選んで「準備OK」か「今回は見送る」にする。
 * 言い出した人は、全員が選び終えたら（待ちきれなければ準備 OK の人だけで）スタートの合図を出す
 */
export class OnlineRacePanel {
  private readonly root = el('online-race');
  private readonly cond = el('or-cond');
  private readonly status = el('or-status');
  private readonly cars = el('or-cars');
  private readonly entrants = el('or-entrants');
  private readonly readyButton = el<HTMLButtonElement>('or-ready');
  private readonly startButton = el<HTMLButtonElement>('or-start');
  private readonly leaveButton = el<HTMLButtonElement>('or-leave');
  private view: OnlineRaceView | null = null;
  private car: string;
  private openValue = false;

  constructor(
    choices: readonly BoardChoice[],
    initialCar: string,
    private readonly carLabel: (id: string) => string,
    private readonly handlers: OnlineRacePanelHandlers,
  ) {
    this.car = initialCar;
    this.cars.innerHTML = choices
      .map((c) => `<button type="button" class="rk-course" role="option" data-id="${escapeHtml(c.id)}"><span>${escapeHtml(c.label)}</span>${c.note ? `<small>${escapeHtml(c.note)}</small>` : ''}</button>`)
      .join('');
    this.cars.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
      if (!b) return;
      this.car = b.dataset.id!;
      // 準備 OK のまま車を替えたら、その車で出直す
      if (this.isReady) this.handlers.onReady(true, this.car);
      this.render();
    });
    this.readyButton.addEventListener('click', () => this.handlers.onReady(!this.isReady, this.car));
    this.startButton.addEventListener('click', () => this.handlers.onStart(this.undecided));
    this.leaveButton.addEventListener('click', () => this.handlers.onLeave());
    el('or-hide').addEventListener('click', () => this.close());
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  get selectedCar(): string {
    return this.car;
  }

  private get isReady(): boolean {
    return !!this.view && this.view.race.entrants.includes(this.view.selfId);
  }

  /** まだ準備 OK も見送りも選んでいない人の数 */
  private get undecided(): number {
    const v = this.view;
    return v ? v.members.filter((m) => !v.race.entrants.includes(m.id) && !v.race.out.includes(m.id)).length : 0;
  }

  /** 対戦の様子が変わったとき（開いていなければ中身だけ変える） */
  update(view: OnlineRaceView | null): void {
    this.view = view;
    if (!view || view.race.phase !== 'entry') {
      this.close();
      return;
    }
    this.render();
  }

  open(car?: string): void {
    if (!this.view) return;
    if (car) this.car = car;
    if (!this.openValue) {
      this.openValue = true;
      this.root.classList.remove('hidden');
      this.handlers.onOpenChange(true);
    }
    this.render(true);
  }

  close(): void {
    if (!this.openValue) return;
    this.openValue = false;
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    this.handlers.onOpenChange(false);
  }

  private render(scroll = false): void {
    const v = this.view;
    if (!v) return;
    const { race, selfId } = v;
    const isHost = race.host === selfId;
    const ready = this.isReady;
    const out = race.out.includes(selfId);
    const hostName = v.members.find((m) => m.id === race.host)?.name ?? '誰か';
    const waiting = this.undecided;
    const count = race.entrants.length;
    this.cond.textContent = v.conditions;
    this.status.textContent = isHost
      ? count === 0
        ? '車を選んで「準備OK」。全員が準備OKか見送りを選んだら「スタート」を押してください。'
        : waiting === 0
          ? `全員が選び終えました。「スタート」で、準備OKの${count}人でカウントダウンを始めます。`
          : `あと${waiting}人が選んでいます。待ちきれなければ、準備OKの人だけでスタートできます。`
      : out
        ? '今回は見送ります（対戦は見ているだけ）。出るなら車を選んで「準備OK」を押してください。'
        : ready
          ? waiting === 0
            ? `全員が選び終えました。${hostName} さんのスタートの合図を待っています…`
            : `あと${waiting}人が選んでいます。${hostName} さんのスタートの合図を待っています…`
          : '車を選んで「準備OK」を押してください。出ないときは「今回は見送る」。';
    for (const b of this.cars.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      const on = b.dataset.id === this.car;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-selected', String(on));
      if (on && scroll) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    this.entrants.innerHTML = v.members
      .map((m) => {
        const order = race.entrants.indexOf(m.id);
        const skipped = race.out.includes(m.id);
        const car = m.id === selfId ? this.car : m.car;
        return `<li class="${order >= 0 ? 'ready' : skipped ? 'out' : ''}${m.id === selfId ? ' me' : ''}"><span class="dot" style="background:${hex(m.color)}"></span><span class="name">${escapeHtml(m.name)}${
          m.id === race.host ? '<i>主催</i>' : ''
        }</span><span class="car">${escapeHtml(this.carLabel(car))}</span><span class="mark">${order >= 0 ? '準備OK' : skipped ? '見送り' : '選択中'}</span></li>`;
      })
      .join('');
    this.readyButton.textContent = ready ? '準備OKを取り消す' : '準備OK';
    this.readyButton.classList.toggle('primary', !ready);
    this.startButton.classList.toggle('hidden', !isHost);
    this.startButton.disabled = count === 0;
    this.startButton.textContent = waiting === 0 || count === 0 ? 'スタート' : `準備OKの${count}人でスタート`;
    this.leaveButton.textContent = isHost ? '対戦をやめる' : '今回は見送る';
    this.leaveButton.classList.toggle('hidden', out);
  }
}
