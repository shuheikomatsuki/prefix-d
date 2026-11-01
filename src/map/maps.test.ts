import { describe, expect, it } from 'vitest';
import { MAPS, TITLE_MAPS } from './maps';
import { buildRoad } from './road';

describe('TITLE_MAPS', () => {
  it('練習用のコースと長いコースを含まない', () => {
    const ids = TITLE_MAPS.map((m) => m.id);
    for (const id of ['town', 'school', 'iroha-up', 'iroha-down']) expect(ids).not.toContain(id);
    expect(ids).toContain('shutoko-c1');
    expect(ids).toContain('pass-down');
  });

  it('どれも MAPS にある', () => {
    for (const m of TITLE_MAPS) expect(MAPS).toContain(m);
  });
});

describe('road maps', () => {
  it('have no slope steeper than 20% (the start height is set for courses that begin high up)', () => {
    for (const m of MAPS) {
      if (!m.road) continue;
      const r = buildRoad(m.road);
      for (let i = 1; i < r.count; i++) expect(Math.abs(r.h[i] - r.h[i - 1]) / r.step, `${m.id} at ${i}`).toBeLessThan(0.2);
    }
  });
});
