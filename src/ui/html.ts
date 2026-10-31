/** 名前などを HTML に埋め込むときに、タグとして解釈されないようにする */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** 0xff5a4f のような色の数値を、CSS の '#ff5a4f' にする */
export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
