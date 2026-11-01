import { escapeHtml } from './html';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} not found`);
  return e as T;
}

/** メニューの選択肢の1つ（マップ・車など） */
export interface MenuChoice {
  id: string;
  label: string;
  /** 名前の下に小さく出す説明 */
  note?: string;
  /** 名前の右に出す小さな印（得意なコース・勝ったことのある相手など） */
  badge?: string;
  /** まだ選んで進めない（解放されていない）。選んで説明を見ることはできるが、次へ進めない */
  locked?: boolean;
}

/** 1つを選ぶ選択肢のまとまり */
export interface MenuGroup {
  /** 画面に1つだけのときは省略してよい（画面の題が見出しになる） */
  title?: string;
  choices: () => readonly MenuChoice[];
  selected: () => string | null;
  select: (id: string) => void;
}

/**
 * 右側（縦長の画面では上）に出す、選んでいるものの詳しい説明。
 * mount は html を入れた後に呼ぶ（canvas に地図を描く・車の見た目を置くなど）。返した関数は、表示を替えるときに呼ぶ
 */
export interface DetailView {
  html: string;
  mount?: (root: HTMLElement) => (() => void) | void;
}

/** 選んでいく画面の1枚 */
export interface MenuScreen {
  title: string;
  /** 題の上に出す英語の小さな見出し */
  en: string;
  groups: readonly MenuGroup[];
  detail: () => DetailView;
}

/** 選んでいるもののどれかが locked なら、次へ進めない */
function screenBlocked(screen: MenuScreen): boolean {
  return screen.groups.some((g) => {
    const id = g.selected();
    return g.choices().some((c) => c.id === id && c.locked);
  });
}

/** プレイモード（トップ画面で選ぶ）と、その後に続けて選んでいく画面 */
export interface MenuMode {
  id: string;
  label: string;
  en: string;
  note: string;
  /** トップ画面でこのモードにカーソルを合わせたときの説明 */
  detail: () => DetailView;
  /** 選び始めるときに呼ぶ（選択の下書きを今の状態から作るなど） */
  begin: () => void;
  screens: () => readonly MenuScreen[];
  /** これまでに選んだもの（画面の上に出す） */
  summary: () => string;
  /** 最後の画面で「スタート」を押したとき */
  finish: () => void;
  /** 最後の画面のボタンの文字（なければ「スタート」） */
  finishLabel?: string;
}

/** トップ画面・ポーズ画面・設定画面に並べる項目 */
export interface MenuItem {
  label: () => string;
  en?: string;
  note?: () => string;
  /** 設定の今の値（右端に出す。押すと run で切り替わる） */
  value?: () => string;
  run: () => void;
  visible?: () => boolean;
  detail?: () => DetailView;
  /** トップ画面でプレイモードと同じ大きさで出す（オンラインなど） */
  major?: boolean;
}

type Stage = 'title' | 'home' | 'mode' | 'pause' | 'settings';

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * ゲームのメニュー。最初はタイトル画面から始まり、トップ画面でプレイモードを選んで、
 * コース・対戦相手・車などを1枚ずつ選んでいく（左に一覧、右に選んでいるものの詳しい説明）。
 * 走っている間は Esc（スマホは ☰）でポーズ画面を開く。ポーズ画面からトップ画面へ戻れる
 */
export class GameMenu {
  private readonly root = el('menu');
  private readonly titleScreen = el('menu-title-screen');
  private readonly frame = el('menu-frame');
  private readonly crumbEl = el('menu-crumb');
  private readonly titleEnEl = el('menu-title-en');
  private readonly titleEl = el('menu-title');
  private readonly summaryEl = el('menu-summary');
  private readonly stepsEl = el('menu-steps');
  private readonly listEl = el('menu-list');
  private readonly detailEl = el('menu-detail');
  private readonly backButton = el<HTMLButtonElement>('menu-back');
  private readonly nextButton = el<HTMLButtonElement>('menu-next');
  private openValue = false;
  private stage: Stage = 'title';
  /** 設定画面を閉じたときに戻る画面 */
  private settingsReturn: Stage = 'home';
  /** openFlow で開いた流れの最初の画面で「戻る」を押したときの行き先（トップ画面のプレイモードから入ったときは null） */
  private flowReturn: 'pause' | 'home' | 'close' | null = null;
  /** 選んでいるプレイモード */
  private mode: MenuMode | null = null;
  private step = 0;
  /** 項目の画面（トップ・ポーズ・設定）でカーソルのある項目 */
  private cursor = 0;
  /** 選んでいく画面で、キーボードで選んでいる選択肢のまとまり */
  private focusGroup = 0;
  private detailCleanup: (() => void) | null = null;

  constructor(
    private readonly modes: readonly MenuMode[],
    private readonly lists: { home: readonly MenuItem[]; pause: readonly MenuItem[]; settings: readonly MenuItem[] },
    private readonly handlers: {
      onOpenChange: (open: boolean) => void;
      /** Esc で開いてよいか（他の画面を開いているときは開かない） */
      canOpen: () => boolean;
      /** トップ画面の題の下に出す、いまの状態 */
      info: () => string;
    },
  ) {
    this.listEl.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest('button[data-item]') as HTMLButtonElement | null;
      if (item) {
        this.cursor = Number(item.dataset.item);
        this.activate();
        return;
      }
      const choice = target.closest('button[data-group]') as HTMLButtonElement | null;
      if (!choice) return;
      this.focusGroup = Number(choice.dataset.group);
      this.choose(this.focusGroup, choice.dataset.id!);
    });
    // パソコンでは、カーソルを合わせただけで右側の説明を替える
    this.listEl.addEventListener('pointerover', (e) => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const item = (e.target as HTMLElement).closest('button[data-item]') as HTMLButtonElement | null;
      if (!item || Number(item.dataset.item) === this.cursor) return;
      this.cursor = Number(item.dataset.item);
      this.markCursor();
    });
    this.titleScreen.addEventListener('click', () => this.go('home'));
    this.backButton.addEventListener('click', () => this.back());
    this.nextButton.addEventListener('click', () => this.next());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get isOpen(): boolean {
    return this.openValue;
  }

  /** 後ろの景色を、車の周りを回るカメラで見せる画面か（タイトル・トップ・モードの画面） */
  get showcase(): boolean {
    return this.openValue && this.stage !== 'pause' && !(this.stage === 'settings' && this.settingsReturn === 'pause');
  }

  /** タイトル画面から開く（起動したとき） */
  openTitle(): void {
    this.show('title');
  }

  /** トップ画面（プレイモードを選ぶ）を開く */
  openHome(): void {
    this.show('home');
  }

  /** 設定画面を開く（閉じると、開いた画面に戻る） */
  openSettings(): void {
    this.show('settings');
  }

  /** 走っている間のポーズ画面を開く */
  openPause(): void {
    this.show('pause');
  }

  /**
   * トップ画面を通らずに、選ぶ画面の流れ（コース・車を変えるなど）を開く。
   * 最初の画面で「戻る」を押すと、ポーズ画面・トップ画面から開いたならその画面へ、そうでなければ閉じる
   */
  openFlow(mode: MenuMode): void {
    this.flowReturn = this.openValue && (this.stage === 'pause' || this.stage === 'home') ? this.stage : 'close';
    this.enterMode(mode);
    this.reveal();
  }

  close(): void {
    if (!this.openValue) return;
    this.openValue = false;
    this.clearDetail();
    this.root.classList.add('hidden');
    (document.activeElement as HTMLElement | null)?.blur();
    this.handlers.onOpenChange(false);
  }

  /** 表示を今の状態に合わせる（開いていないときは何もしない） */
  refresh(): void {
    if (this.openValue) this.render();
  }

  private show(stage: Stage): void {
    this.go(stage);
    this.reveal();
  }

  private reveal(): void {
    if (this.openValue) return;
    this.openValue = true;
    this.root.classList.remove('hidden');
    this.handlers.onOpenChange(true);
  }

  private go(stage: Stage): void {
    if (stage !== 'mode') this.flowReturn = null;
    if (stage === 'settings') this.settingsReturn = this.stage === 'pause' ? 'pause' : 'home';
    if (stage !== 'mode') this.mode = null;
    this.stage = stage;
    this.cursor = 0;
    this.render();
  }

  private items(): readonly MenuItem[] {
    if (this.stage === 'home') {
      const modes: MenuItem[] = this.modes.map((m) => ({
        label: () => m.label,
        en: m.en,
        note: () => m.note,
        detail: m.detail,
        run: () => this.enterMode(m),
        major: true,
      }));
      return [...modes, ...this.lists.home].filter((i) => i.visible?.() !== false);
    }
    const list = this.stage === 'pause' ? this.lists.pause : this.stage === 'settings' ? this.lists.settings : [];
    return list.filter((i) => i.visible?.() !== false);
  }

  private enterMode(mode: MenuMode): void {
    this.stage = 'mode';
    this.mode = mode;
    this.step = 0;
    this.focusGroup = 0;
    mode.begin();
    this.render();
  }

  private screen(): MenuScreen | null {
    return this.mode?.screens()[this.step] ?? null;
  }

  private choose(group: number, id: string): void {
    const screen = this.screen();
    if (!screen) return;
    screen.groups[group]?.select(id);
    this.render();
  }

  private activate(): void {
    const item = this.items()[this.cursor];
    if (!item) return;
    item.run();
    // 設定を切り替えたときは、その場で値を替える（別の画面へ移ったときは移った先で描き直している）
    if (this.openValue && this.stage === 'settings') this.render();
  }

  private back(): void {
    switch (this.stage) {
      case 'mode':
        if (this.step > 0) {
          this.step--;
          this.focusGroup = 0;
          this.render();
        } else if (this.flowReturn === 'pause' || this.flowReturn === 'home') {
          this.go(this.flowReturn);
        } else if (this.flowReturn === 'close') {
          this.close();
        } else {
          const index = this.modes.indexOf(this.mode!);
          this.go('home');
          this.cursor = Math.max(0, index);
          this.markCursor();
        }
        break;
      case 'settings':
        this.go(this.settingsReturn);
        break;
      case 'pause':
      case 'home':
        this.close();
        break;
    }
  }

  private next(): void {
    if (this.stage !== 'mode' || !this.mode) return;
    const screen = this.screen();
    if (screen && screenBlocked(screen)) return;
    if (this.step < this.mode.screens().length - 1) {
      this.step++;
      this.focusGroup = 0;
      this.render();
      return;
    }
    const mode = this.mode;
    this.close();
    mode.finish();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    if (!this.openValue) {
      if (e.key === 'Escape' && !e.repeat && this.handlers.canOpen()) {
        this.openPause();
        e.preventDefault();
      }
      return;
    }
    // 入力欄に文字を打っているときは触らない
    if ((e.target as HTMLElement | null)?.closest?.('input, select, textarea')) return;
    if (this.stage === 'title') {
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      this.go('home');
      e.preventDefault();
      return;
    }
    const key = e.key;
    if (key === 'Escape' || key === 'Backspace') {
      if (!e.repeat) this.back();
    } else if (key === 'Enter' || key === ' ') {
      if (e.repeat) return;
      if (this.stage === 'mode') this.next();
      else this.activate();
    } else if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'w' || key === 's') {
      const d = key === 'ArrowUp' || key === 'w' ? -1 : 1;
      if (this.stage === 'mode') {
        const screen = this.screen()!;
        if (screen.groups.length > 1) {
          this.focusGroup = (this.focusGroup + d + screen.groups.length) % screen.groups.length;
          this.render();
        } else this.moveChoice(d);
      } else {
        const n = this.items().length;
        this.cursor = (this.cursor + d + n) % n;
        this.markCursor();
      }
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'a' || key === 'd') {
      const d = key === 'ArrowLeft' || key === 'a' ? -1 : 1;
      if (this.stage === 'mode') this.moveChoice(d);
      else if (this.stage === 'settings') this.activate();
      else return;
    } else return;
    e.preventDefault();
  }

  /** キーボードで、選んでいるまとまりの1つ前・後ろの選択肢を選ぶ */
  private moveChoice(d: number): void {
    const group = this.screen()?.groups[this.focusGroup];
    if (!group) return;
    const choices = group.choices();
    const i = choices.findIndex((c) => c.id === group.selected());
    const next = choices[(Math.max(0, i) + d + choices.length) % choices.length];
    this.choose(this.focusGroup, next.id);
    this.listEl.querySelector('.choice.selected.focused')?.scrollIntoView({ block: 'nearest' });
  }

  private clearDetail(): void {
    this.detailCleanup?.();
    this.detailCleanup = null;
  }

  private renderDetail(view: DetailView | undefined): void {
    this.clearDetail();
    this.detailEl.innerHTML = view?.html ?? '';
    this.detailEl.classList.toggle('empty', !view);
    // 文だけの説明か（縦向きの画面で、説明をスクロールさせずに中身の高さで出すため。:has() の使えないブラウザもあるので印を付ける）
    this.root.classList.toggle('detail-plain', this.detailEl.querySelector('.d-plain') !== null);
    this.detailCleanup = view?.mount?.(this.detailEl) ?? null;
  }

  /** 項目の画面で、カーソルのある項目の印と右側の説明だけを替える */
  private markCursor(): void {
    const items = this.items();
    this.cursor = Math.min(this.cursor, items.length - 1);
    this.listEl.querySelectorAll<HTMLButtonElement>('button[data-item]').forEach((b) => {
      b.classList.toggle('cursor', Number(b.dataset.item) === this.cursor);
    });
    this.listEl.querySelector('.cursor')?.scrollIntoView({ block: 'nearest' });
    const item = items[this.cursor];
    this.renderDetail(item?.detail?.() ?? (this.stage === 'settings' ? undefined : this.lists.home[0]?.detail?.()));
  }

  private render(): void {
    const stage = this.stage;
    this.root.dataset.stage = stage;
    this.titleScreen.classList.toggle('hidden', stage !== 'title');
    this.frame.classList.toggle('hidden', stage === 'title');
    if (stage === 'title') {
      this.clearDetail();
      return;
    }
    const isMode = stage === 'mode';
    this.nextButton.classList.toggle('hidden', !isMode);
    if (!isMode) {
      const heading: Record<Exclude<Stage, 'title' | 'mode'>, [string, string, string]> = {
        home: ['MAIN MENU', 'TOP', 'プレイモード'],
        pause: ['MENU', 'MENU', 'メニュー'],
        settings: ['OPTIONS', 'OPTIONS', '設定'],
      };
      const [crumb, en, title] = heading[stage];
      this.crumbEl.textContent = crumb;
      this.titleEnEl.textContent = en;
      this.titleEl.textContent = title;
      this.summaryEl.textContent = this.handlers.info();
      this.stepsEl.innerHTML = '';
      this.backButton.textContent = stage === 'settings' ? '戻る' : stage === 'pause' ? '走りに戻る' : '閉じる';
      const items = this.items();
      this.cursor = Math.min(this.cursor, items.length - 1);
      this.listEl.className = `items ${stage}`;
      // トップ画面はプレイモードを大きく、その下にほかの項目を小さく並べる
      this.listEl.innerHTML = items
        .map((item, i) => {
          const isModeItem = stage === 'home' && item.major === true;
          const note = item.note?.();
          const value = item.value?.();
          return `<button type="button" class="item${isModeItem ? ' major' : ''}" data-item="${i}">${
            isModeItem ? `<span class="idx">${pad2(i + 1)}</span>` : ''
          }<span class="text"><span class="label">${escapeHtml(item.label())}</span>${
            item.en ? `<span class="en">${escapeHtml(item.en)}</span>` : ''
          }${note ? `<small>${escapeHtml(note)}</small>` : ''}</span>${value !== undefined ? `<span class="value">${escapeHtml(value)}</span>` : '<span class="arrow"></span>'}</button>`;
        })
        .join('');
      this.markCursor();
      return;
    }
    const mode = this.mode!;
    const screens = mode.screens();
    this.step = Math.min(this.step, screens.length - 1);
    const screen = screens[this.step];
    this.crumbEl.textContent = `${mode.en} · ${mode.label}`;
    this.titleEnEl.textContent = `${pad2(this.step + 1)} / ${pad2(screens.length)}  ${screen.en}`;
    this.titleEl.textContent = screen.title;
    this.summaryEl.textContent = mode.summary();
    this.backButton.textContent = '戻る';
    this.nextButton.textContent = this.step === screens.length - 1 ? (mode.finishLabel ?? 'スタート') : '次へ';
    this.nextButton.classList.toggle('start', this.step === screens.length - 1);
    this.nextButton.disabled = screenBlocked(screen);
    this.stepsEl.innerHTML = screens
      .map((s, i) => `<li class="${i < this.step ? 'done' : i === this.step ? 'current' : ''}"><span>${pad2(i + 1)}</span>${escapeHtml(s.title)}</li>`)
      .join('');
    this.focusGroup = Math.min(this.focusGroup, screen.groups.length - 1);
    const scroll = this.listEl.scrollTop;
    const sameScreen = this.listEl.dataset.screen === `${mode.id}:${this.step}`;
    this.listEl.className = `choices${screen.groups.length > 1 ? ' multi' : ''}`;
    this.listEl.dataset.screen = `${mode.id}:${this.step}`;
    this.listEl.innerHTML = screen.groups
      .map((g, gi) => {
        const selected = g.selected();
        const choices = g
          .choices()
          .map(
            (c) =>
              `<button type="button" class="choice${c.id === selected ? ' selected' : ''}${c.locked ? ' locked' : ''}${c.id === selected && gi === this.focusGroup ? ' focused' : ''}" data-group="${gi}" data-id="${escapeHtml(c.id)}"><span class="label">${escapeHtml(c.label)}${
                c.badge ? `<span class="badge">${escapeHtml(c.badge)}</span>` : ''
              }</span>${c.note ? `<small>${escapeHtml(c.note)}</small>` : ''}</button>`,
          )
          .join('');
        return `<section class="group${gi === this.focusGroup && screen.groups.length > 1 ? ' focused' : ''}">${g.title ? `<h3>${escapeHtml(g.title)}</h3>` : ''}<div class="list">${choices}</div></section>`;
      })
      .join('');
    // 同じ画面で選び直したときは、一覧のスクロールを保つ
    if (sameScreen) this.listEl.scrollTop = scroll;
    else this.listEl.querySelector('.choice.selected')?.scrollIntoView({ block: 'nearest' });
    this.renderDetail(screen.detail());
  }
}
