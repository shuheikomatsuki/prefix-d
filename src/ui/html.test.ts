import { describe, expect, it } from 'vitest';
import { escapeHtml, hex } from './html';

describe('escapeHtml', () => {
  it('escapes characters that would become tags or attributes', () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe('&#60;b a=&#34;1&#34;&#62;&#39;&#38;&#39;&#60;/b&#62;');
  });
  it('leaves ordinary text alone', () => {
    expect(escapeHtml('たくみ 86')).toBe('たくみ 86');
  });
});

describe('hex', () => {
  it('pads to six digits', () => {
    expect(hex(0xff5a4f)).toBe('#ff5a4f');
    expect(hex(0x0000ff)).toBe('#0000ff');
  });
});
