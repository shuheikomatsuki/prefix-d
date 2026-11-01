import { describe, expect, it } from 'vitest';
import { sectionReportHtml } from './sectionReport';

describe('sectionReportHtml', () => {
  it('lists each section and names the worst and best', () => {
    const html = sectionReportHtml({ gaps: [-0.5, 1.24, null], worst: 1, best: 0 }, '須藤<京一>');
    expect(html).toContain('区間2</b>（+1.24秒）');
    expect(html).toContain('区間1</b>は須藤&#60;京一&#62;より0.50秒速かった');
    expect(html).toContain('<b>—</b>');
    // 合計で遅れているので、詰めどころとして伝える
    expect(html).toContain('ここを詰めれば');
    expect(sectionReportHtml({ gaps: [-2, 1, null], worst: 1, best: 0 }, 'x')).not.toContain('ここを詰めれば');
    // 合計で勝っているときは「離された」と言わない
    const winning = sectionReportHtml({ gaps: [-2, 1, null], worst: 1, best: 0 }, 'x');
    expect(winning).not.toContain('離された');
    expect(winning).toContain('xにいちばん詰められたのは<b>区間2</b>');
  });

  it('is empty before any section has been compared', () => {
    expect(sectionReportHtml({ gaps: [null, null, null], worst: null, best: null }, 'x')).toBe('');
  });
});
