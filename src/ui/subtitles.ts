import { type DialogueLine, lineDuration, splitLine } from '../race/dialogue';
import { escapeHtml } from './html';
import { SHOW_PORTRAITS } from './portraits';

/** 話す人の表示（名前と、あれば画像） */
export interface Speaker {
  name: string;
  photo?: string;
  /** 自分のセリフか（色を変える） */
  isPlayer?: boolean;
  /** 効果音の字幕（名前を出さない） */
  isEffect?: boolean;
}

type Item = { speaker: Speaker; text: string; sound?: string };

function face(s: Speaker): string {
  if (s.isEffect) return '<span>！</span>';
  if (s.photo) return `<img src="${escapeHtml(import.meta.env.BASE_URL + s.photo)}" alt="" />`;
  return `<span>${escapeHtml([...s.name][0] ?? '?')}</span>`;
}

/**
 * セリフの字幕。走っている間は画面の下に小さく（操作のじゃまにならないよう、触っても下の操作に届く）、
 * スタート前や勝負のあとの場面は、下に大きな枠を出してタップ・Enter で進める。
 */
export class Subtitles {
  private readonly line = document.getElementById('subtitle')!;
  private readonly scene = document.getElementById('scene')!;
  private readonly sceneFace = this.scene.querySelector<HTMLElement>('.scene-face')!;
  private readonly sceneName = this.scene.querySelector<HTMLElement>('.scene-name')!;
  private readonly sceneText = this.scene.querySelector<HTMLElement>('.scene-text')!;
  private queue: Item[] = [];
  private lineTimer = 0;
  private sceneLines: Item[] = [];
  private sceneIndex = 0;
  private sceneDone: (() => void) | null = null;

  constructor(
    private readonly resolve: (who: string) => Speaker,
    private readonly playSound: (name: string) => void = () => {},
  ) {
    // 画像を出さないときは顔の枠をとらない
    this.sceneFace.hidden = !SHOW_PORTRAITS;
    this.scene.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.scene-skip')) this.endScene();
      else this.advance();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.sceneActive) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.advance();
      }
    }, true);
  }

  get sceneActive(): boolean {
    return this.sceneDone !== null;
  }

  /** 走っている間のセリフ（前のセリフが出ている間は順番を待つ。長いセリフは区切って順に出す） */
  say(lines: readonly DialogueLine[]): void {
    for (const l of lines) {
      (l.whole ? [l.text] : splitLine(l.text)).forEach((text, i) => this.queue.push({ ...this.item(l), text, sound: i === 0 ? l.sound : undefined }));
    }
    if (this.lineTimer <= 0) this.next();
  }

  /** 毎フレーム呼ぶ（dt [s]） */
  update(dt: number): void {
    if (this.lineTimer <= 0) return;
    this.lineTimer -= dt;
    if (this.lineTimer <= 0) this.next();
  }

  /** 場面を出す。lines が空ならすぐ done を呼ぶ */
  playScene(lines: readonly DialogueLine[], done: () => void): void {
    this.endScene(false);
    // 走っている間の字幕は場面と重ならないよう消す
    this.queue = [];
    this.lineTimer = 0;
    this.line.classList.remove('visible');
    if (lines.length === 0) {
      done();
      return;
    }
    this.sceneLines = lines.map((l) => this.item(l));
    this.sceneIndex = 0;
    this.sceneDone = done;
    this.scene.classList.remove('hidden');
    document.body.classList.add('in-scene');
    this.showSceneLine();
  }

  /** 字幕と場面をすべて消す（レースをやめたときなど。場面の done は呼ばない） */
  clear(): void {
    this.queue = [];
    this.lineTimer = 0;
    this.line.classList.remove('visible');
    this.endScene(false);
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.lineTimer = 0;
      this.line.classList.remove('visible');
      return;
    }
    const who = item.speaker.isEffect ? '' : `<span class="who${item.speaker.isPlayer ? ' me' : ''}">${escapeHtml(item.speaker.name)}</span>`;
    this.line.innerHTML = `${who}<span class="text">${escapeHtml(item.text)}</span>`;
    this.line.classList.toggle('effect', !!item.speaker.isEffect);
    this.line.classList.add('visible');
    if (item.sound) this.playSound(item.sound);
    this.lineTimer = lineDuration(item.text);
  }

  /** 場面の次のセリフへ（最後なら閉じる） */
  advance(): void {
    if (!this.sceneActive) return;
    this.sceneIndex++;
    if (this.sceneIndex >= this.sceneLines.length) this.endScene();
    else this.showSceneLine();
  }

  private showSceneLine(): void {
    const { speaker, text, sound } = this.sceneLines[this.sceneIndex];
    this.scene.classList.toggle('effect', !!speaker.isEffect);
    if (sound) this.playSound(sound);
    this.sceneFace.innerHTML = face(speaker);
    this.sceneFace.classList.toggle('photo', !!speaker.photo);
    this.sceneName.textContent = speaker.name;
    this.sceneName.classList.toggle('me', !!speaker.isPlayer);
    this.sceneText.textContent = text;
    this.scene.classList.toggle('last', this.sceneIndex === this.sceneLines.length - 1);
  }

  private item(l: DialogueLine): Item {
    return { speaker: this.resolve(l.who), text: l.text, sound: l.sound };
  }

  private endScene(callDone = true): void {
    const done = this.sceneDone;
    this.sceneDone = null;
    this.scene.classList.add('hidden');
    document.body.classList.remove('in-scene');
    if (callDone) done?.();
  }
}
