import { escapeHtml, hex } from './html';

/** 画面に残すセリフの数 */
const FEED_SIZE = 4;

/** 画面の隅に出す、自分と部屋のみんなのセリフの一覧（しばらくすると消える） */
export class EmoteFeed {
  private readonly list = document.getElementById('emote-feed')!;

  add(name: string, color: number, text: string): void {
    const li = document.createElement('li');
    li.innerHTML = `<span class="dot" style="background:${hex(color)}"></span><b>${escapeHtml(name)}</b>${escapeHtml(text)}`;
    this.list.appendChild(li);
    while (this.list.children.length > FEED_SIZE) this.list.firstElementChild?.remove();
    window.setTimeout(() => li.classList.add('fade'), 5000);
    window.setTimeout(() => li.remove(), 5500);
  }
}
