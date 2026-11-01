import { beforeAll, describe, expect, it } from 'vitest';
import { MAPS } from '../map/maps';
import { NPC_LEVELS } from './npcDriver';
import { initNpcSim, simulateNpcRace } from './npcSim';

/**
 * 全レベルの NPC がコースを道から外れずに完走するか。重いので、コースを parts 個に分けて
 * 別々のテストファイル（npcCourses.N.sim.test.ts）から呼び、並列に走らせる
 */
export function describeCourseRaces(part: number, parts: number): void {
  describe(`NPC race (courses ${part + 1}/${parts})`, () => {
    beforeAll(initNpcSim);
    const courses = MAPS.filter((m) => m.race).filter((_, i) => i % parts === part);
    it.each(courses.map((m) => [m.name, m] as const))(
      'every level finishes %s without leaving the road',
      (_, def) => {
        const { racers } = simulateNpcRace(def, [...NPC_LEVELS]);
        const times = racers.map((r) => r.timer.laps[0]);
        console.log(def.name, NPC_LEVELS.map((l, i) => `${l.label} ${times[i]?.toFixed(2)} off ${racers[i].maxOffset.toFixed(1)} hit ${racers[i].maxImpact.toFixed(1)}`).join(' / '));
        for (const r of racers) {
          expect(r.timer.phase).toBe('finished');
          // 押し合って路肩の草地へはみ出すことはあっても、崖から落ちるほどは外れない
          expect(r.maxOffset).toBeLessThan(3);
        }
      },
      // いちばん長いいろは坂（ヒルクライム・9.4km）は CI で 80 秒あまりかかる
      180000,
    );
  });
}
