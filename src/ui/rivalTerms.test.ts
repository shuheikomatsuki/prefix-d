import { describe, expect, it } from 'vitest';
import { RIVALS } from '../race/rivals';
import { missedTermsText, unlockText, winTermsText } from './rivalTerms';

const byId = (id: string) => RIVALS.find((r) => r.id === id)!;

describe('rivalTerms', () => {
  it('describes the terms for a win', () => {
    expect(winTermsText(byId('takumi'), () => '秋名')).toBe('秋名');
    expect(winTermsText(byId('kenta'), () => '山越え')).toBe('山越え・夜・雨');
    expect(winTermsText(byId('shingo'), () => 'Uターン')).toBe('Uターン・ラフプレーあり');
    expect(missedTermsText(byId('kenta'), ['course', 'weather'])).toBe('得意コース以外・天気が雨でない');
  });

  it('tells which rivals are left to unlock', () => {
    expect(unlockText(byId('kenta'), [byId('iketani')])).toBe('初級のライバルを全員倒すと解放（残り: 池谷浩一郎）');
    expect(unlockText(byId('takumi'), [byId('iwaki')])).toBe('初級〜上級のライバルを全員倒すと解放（残り: 岩城清次）');
  });
});
