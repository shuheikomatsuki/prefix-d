import { ordinal } from '../ui/raceHud';
import { describe, expect, it } from 'vitest';
import { SCHOOL_MAP } from '../map/maps';
import { CIRCUIT_MAP, DOWNHILL_MAP, HILLCLIMB_MAP, TECHNICAL_MAP } from '../map/testMaps';
import { parseMap } from '../map/tilemap';
import { buildCourse } from './course';
import { GhostRecorder, ghostPoseAt } from './ghost';
import { mergeRecord, parseRecord, staleRecordKeys } from './records';
import { COUNTDOWN_SECONDS, TimeAttack, formatTime } from './timeAttack';
import { rankEntrants } from '../game/npcRace';

const course = buildCourse(parseMap(CIRCUIT_MAP));
const size = CIRCUIT_MAP.tileSize;

describe('buildCourse', () => {
  it('traces the whole circuit as one loop', () => {
    const roads = course.map.tiles.filter((t) => t.kind === 'road').length;
    expect(course.tiles.length).toBe(roads);
    expect(course.tiles[0]).toMatchObject({ col: 6, row: 1, exit: 'E' });
    // 一周の終わりはスタートの1つ手前（西隣）
    const last = course.tiles[course.tiles.length - 1];
    expect([last.col, last.row]).toEqual([5, 1]);
  });

  it('puts the start line at the entry of the start tile', () => {
    expect(course.line.x).toBeCloseTo(6 * size - size / 2);
    expect(course.line.z).toBeCloseTo(size);
    const spot = course.gridSpot(8, 3);
    expect(spot.x).toBeCloseTo(course.line.x - 8);
    // 東向きの左は北（-Z）
    expect(spot.z).toBeCloseTo(course.line.z - 3);
  });

  it('rejects maps with junctions', () => {
    expect(() => buildCourse(parseMap(SCHOOL_MAP))).toThrow();
  });

  it('gives the travel direction on curves', () => {
    const corner = course.tiles.findIndex((t) => t.col === 13 && t.row === 1);
    const d = course.directionAt(corner);
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.z).toBeCloseTo(Math.SQRT1_2);
  });
});

describe('course geometry', () => {
  it('measures the centerline (straights + quarter circles)', () => {
    const curves = course.tiles.filter((t) => t.entry !== t.exit).length;
    const straights = course.tiles.length - curves;
    expect(course.length).toBeCloseTo(straights * size + curves * (Math.PI / 2) * (size / 2));
    expect(course.closed).toBe(true);
  });

  it('projects points on the centerline back to the same distance', () => {
    for (let s = 0; s < course.length; s += 7.3) {
      const p = course.pointAt(s);
      const pr = course.project(p.x, p.z);
      expect(pr.s).toBeCloseTo(s, 5);
      expect(pr.offset).toBeCloseTo(0, 5);
      // 左へずらすと offset が正になる
      const left = course.project(p.x + Math.cos(p.yaw) * 3, p.z - Math.sin(p.yaw) * 3);
      expect(left.offset).toBeCloseTo(3, 5);
    }
  });

  it('gives curvature only on curves', () => {
    const corner = course.tiles.findIndex((t) => t.col === 13 && t.row === 1);
    const before = course.pointAt(5);
    expect(before.curvature).toBe(0);
    // サーキットは時計回り（上から見て右回り）なので右カーブ = 負
    let s = 0;
    for (let i = 0; i < corner; i++) s += course.tiles[i].entry === course.tiles[i].exit ? size : (Math.PI / 4) * size;
    expect(course.pointAt(s + 1).curvature).toBeCloseTo(-2 / size);
  });

  it('builds the technical circuit as a loop with many corners', () => {
    const tech = buildCourse(parseMap(TECHNICAL_MAP));
    expect(tech.closed).toBe(true);
    expect(tech.tiles.filter((t) => t.entry !== t.exit).length).toBeGreaterThanOrEqual(20);
  });

  it('builds the mountain pass as a point-to-point course in both directions', () => {
    const up = buildCourse(parseMap(HILLCLIMB_MAP));
    const down = buildCourse(parseMap(DOWNHILL_MAP));
    for (const c of [up, down]) {
      expect(c.closed).toBe(false);
      // 最後の2枚はゴール後に止まるための区間
      expect(c.finishIndex).toBe(c.tiles.length - 2);
      expect(c.length).toBeGreaterThan(1500);
    }
    // 上りの最後のタイルは頂上の行き止まり、下りの最後はふもとの行き止まり
    expect(up.tiles[up.tiles.length - 1]).toMatchObject({ col: 1, row: 1 });
    expect(down.tiles[down.tiles.length - 1]).toMatchObject({ col: 2, row: 14 });
  });
});

describe('TimeAttack on a point-to-point course', () => {
  it('finishes after reaching the finish line once', () => {
    const hill = buildCourse(parseMap(HILLCLIMB_MAP));
    const race = new TimeAttack(hill, 1);
    const ts = HILLCLIMB_MAP.tileSize;
    for (let i = 0; i < 70; i++) race.update(0.05, { x: hill.line.x - 10, z: hill.line.z, vx: 0, vz: 0 });
    expect(race.phase).toBe('racing');
    for (const t of hill.tiles) {
      for (let i = 0; i < 10; i++) race.update(0.05, { x: t.col * ts, z: t.row * ts, vx: 0, vz: 0 });
      if (race.phase === 'finished') break;
    }
    expect(race.phase).toBe('finished');
    expect(race.laps).toHaveLength(1);
    // ゴールのタイルに入った時点で終わる（カウントダウン後の 0.5 秒 + 最初の1ステップを含む）
    expect(race.laps[0]).toBeCloseTo(0.55 + hill.finishIndex * 10 * 0.05, 5);
  });

  it('does not count a shortcut across the grass', () => {
    const hill = buildCourse(parseMap(HILLCLIMB_MAP));
    const race = new TimeAttack(hill, 1);
    const ts = HILLCLIMB_MAP.tileSize;
    for (let i = 0; i < 70; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const goal = hill.tiles[hill.finishIndex];
    race.update(0.05, { x: hill.tiles[0].col * ts, z: hill.tiles[0].row * ts, vx: 0, vz: 0 });
    race.update(0.05, { x: goal.col * ts, z: goal.row * ts, vx: 0, vz: 0 });
    expect(race.phase).toBe('racing');
  });
});

/** 各タイルの中心を順にたどる（1タイルあたり steps ステップ） */
function driveLaps(race: TimeAttack, laps: number, steps = 30, dt = 0.05) {
  const tiles = course.tiles;
  // スタート位置（1つ手前のタイル）から始める
  const order = [tiles[tiles.length - 1], ...Array.from({ length: tiles.length * laps + 1 }, (_, i) => tiles[i % tiles.length])];
  for (const t of order) {
    for (let i = 0; i < steps; i++) race.update(dt, { x: t.col * size, z: t.row * size, vx: 0, vz: 0 });
  }
}

describe('TimeAttack', () => {
  it('counts down before the start', () => {
    const race = new TimeAttack(course, 3);
    const counts: number[] = [];
    for (const e of race.drainEvents()) if (e.type === 'count') counts.push(e.value);
    for (let i = 0; i < 70; i++) {
      race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
      for (const e of race.drainEvents()) if (e.type === 'count') counts.push(e.value);
    }
    expect(counts).toEqual([3, 2, 1, 0]);
    expect(race.phase).toBe('racing');
    expect(race.canDrive).toBe(true);
    expect(race.time).toBeGreaterThan(0);
  });

  it('waits for the signal before counting down when asked to', () => {
    const race = new TimeAttack(course, 3, true);
    expect(race.phase).toBe('ready');
    expect(race.canDrive).toBe(false);
    for (let i = 0; i < 100; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    expect(race.phase).toBe('ready');
    expect(race.time).toBe(-COUNTDOWN_SECONDS);
    expect(race.drainEvents()).toEqual([]);
    race.begin();
    race.begin();
    expect(race.phase).toBe('countdown');
    expect(race.drainEvents()).toEqual([{ type: 'count', value: COUNTDOWN_SECONDS }]);
  });

  it('counts laps when following the course and finishes', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    race.drainEvents();
    driveLaps(race, 3);
    const events = race.drainEvents();
    expect(events.filter((e) => e.type === 'lap').length).toBe(3);
    const finish = events.find((e) => e.type === 'finish');
    expect(finish).toBeDefined();
    expect(race.phase).toBe('finished');
    expect(race.laps.length).toBe(3);
    // 1周 = タイル数 × 30 ステップ × 0.05 秒
    expect(race.laps[1]).toBeCloseTo(course.tiles.length * 30 * 0.05, 5);
  });

  it('does not count a lap when cutting across the infield', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const tiles = course.tiles;
    const at = (t: { col: number; row: number }) => ({ x: t.col * size, z: t.row * size, vx: 0, vz: 0 });
    race.update(0.05, at(tiles[tiles.length - 1]));
    race.update(0.05, at(tiles[0]));
    race.update(0.05, at(tiles[1]));
    // 途中を飛ばして先へ進み、そのまま一周の残りを走る
    const jump = Math.floor(tiles.length / 3);
    for (let i = jump; i <= tiles.length; i++) race.update(0.05, at(tiles[i % tiles.length]));
    const events = race.drainEvents();
    expect(events.some((e) => e.type === 'offCourse' && e.on)).toBe(true);
    expect(events.some((e) => e.type === 'lap')).toBe(false);
  });

  it('remembers where the car left the course so it can be put back after a shortcut', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const tiles = course.tiles;
    const at = (t: { col: number; row: number }) => ({ x: t.col * size, z: t.row * size, vx: 0, vz: 0 });
    race.update(0.05, at(tiles[tiles.length - 1]));
    race.update(0.05, at(tiles[0]));
    race.update(0.05, at(tiles[1]));
    const left = course.project(tiles[1].col * size, tiles[1].row * size).s;
    race.update(0.05, at(tiles[Math.floor(tiles.length / 3)]));
    expect(race.drainEvents().some((e) => e.type === 'offCourse' && e.on)).toBe(true);
    expect(race.rejoin()).toBeCloseTo(left, 5);
    // 戻した所からまた走れば、警告が消えて周回も数える
    race.update(0.05, at(tiles[1]));
    expect(race.drainEvents()).toContainEqual({ type: 'offCourse', on: false });
    for (let i = 2; i <= tiles.length; i++) race.update(0.05, at(tiles[i % tiles.length]));
    expect(race.drainEvents().some((e) => e.type === 'lap')).toBe(true);
  });

  it('warns when driving the wrong way', () => {
    const race = new TimeAttack(course, 3);
    for (let i = 0; i < COUNTDOWN_SECONDS / 0.05; i++) race.update(0.05, { x: 0, z: 0, vx: 0, vz: 0 });
    const start = course.tiles[0];
    // スタートの直線は東向き。西へ走る
    for (let i = 0; i < 30; i++) race.update(0.05, { x: start.col * size, z: start.row * size, vx: -10, vz: 0 });
    expect(race.isWrongWay).toBe(true);
    for (let i = 0; i < 2; i++) race.update(0.05, { x: start.col * size, z: start.row * size, vx: 10, vz: 0 });
    expect(race.isWrongWay).toBe(false);
  });
});

describe('ghost', () => {
  it('records poses at a fixed interval and interpolates between them', () => {
    const rec = new GhostRecorder();
    for (let i = 0; i <= 20; i++) rec.sample(i * 0.05, { x: i, z: 0, yaw: 0 });
    // 0.0, 0.1, ..., 1.0 の 11 個
    expect(rec.frames.length).toBe(33);
    const p = ghostPoseAt(rec.frames, 0.25)!;
    expect(p.x).toBeCloseTo(5);
    expect(ghostPoseAt(rec.frames, 5)).toBeNull();
  });

  it('interpolates yaw across the ±π boundary', () => {
    const data = [0, 0, Math.PI - 0.1, 0, 0, -Math.PI + 0.1];
    const p = ghostPoseAt(data, 0.05)!;
    expect(Math.abs(Math.abs(p.yaw) - Math.PI)).toBeLessThan(0.01);
  });
});

describe('records', () => {
  it('finds the records of the same course and car run on an older shape of the course', () => {
    const p = 'car-game:time-attack:v1:';
    const keys = [`${p}pass-up-aaaaaaa:ae86`, `${p}pass-up-bbbbbbb:ae86`, `${p}pass-up-aaaaaaa:s13`, `${p}pass-up-r-aaaaaaa:ae86`, 'car-game:name'];
    expect(staleRecordKeys(keys, 'pass-up-bbbbbbb', 'ae86')).toEqual([`${p}pass-up-aaaaaaa:ae86`]);
  });

  it('keeps the faster total and the fastest lap', () => {
    const first = mergeRecord(null, { total: 90, laps: [32, 29, 29], ghost: [1, 2, 3] });
    expect(first.newTotal).toBe(true);
    expect(first.record.bestLap).toBe(29);
    const slower = mergeRecord(first.record, { total: 95, laps: [40, 27, 28], ghost: [4, 5, 6] });
    expect(slower.newTotal).toBe(false);
    expect(slower.newLap).toBe(true);
    expect(slower.record.total).toBe(90);
    expect(slower.record.ghost).toEqual([1, 2, 3]);
    expect(slower.record.bestLap).toBe(27);
  });

  it('ignores broken saved data', () => {
    expect(parseRecord('nope')).toBeNull();
    expect(parseRecord('{"total":"x"}')).toBeNull();
    expect(parseRecord('{"total":90,"laps":[30,30,30],"ghost":[1,2]}')?.ghost).toEqual([]);
    // 操作の記録は、ゴーストと数が合うときだけ読む
    expect(parseRecord('{"total":90,"laps":[30,30,30],"ghost":[1,2,3],"inputs":[1,2,3,4,5]}')?.inputs).toEqual([1, 2, 3, 4, 5]);
    expect(parseRecord('{"total":90,"laps":[30,30,30],"ghost":[1,2,3],"inputs":[1,2]}')?.inputs).toBeUndefined();
  });

  it('formats times', () => {
    expect(formatTime(83.456)).toBe('1:23.46');
    expect(formatTime(5.1)).toBe('0:05.10');
  });
});

describe('race standings', () => {
  const tileAt = (i: number) => course.tiles[i % course.tiles.length];
  const at = (t: TimeAttack, i: number) => {
    const tile = tileAt(i);
    t.update(0.05, { x: tile.col * size, z: tile.row * size, vx: 0, vz: 0 });
    return { x: tile.col * size, z: tile.row * size };
  };

  it('measures the distance along the course, including laps', () => {
    const t = new TimeAttack(course, 3);
    for (let i = 0; i < 70; i++) t.update(0.05, { ...course.gridSpot(6), vx: 0, vz: 0 });
    expect(t.distance(course.gridSpot(6).x, course.gridSpot(6).z)).toBeCloseTo(-6);
    let pos = { x: 0, z: 0 };
    for (let i = 0; i <= course.tiles.length + 2; i++) pos = at(t, i);
    expect(t.laps).toHaveLength(1);
    // 2周目の3枚目の中心
    expect(t.distance(pos.x, pos.z)).toBeGreaterThan(course.length);
    expect(t.distance(pos.x, pos.z)).toBeLessThan(course.length + 3 * size);
  });

  it('ranks finished racers by time, then the rest by distance', () => {
    const a = new TimeAttack(course, 1);
    const b = new TimeAttack(course, 1);
    const c = new TimeAttack(course, 1);
    for (const t of [a, b, c]) for (let i = 0; i < 70; i++) t.update(0.05, { ...course.gridSpot(6), vx: 0, vz: 0 });
    const n = course.tiles.length;
    // a と c はゴール（c のほうが速い）、b は半分まで
    let pa = { x: 0, z: 0 };
    let pb = { x: 0, z: 0 };
    let pc = { x: 0, z: 0 };
    for (let i = 0; i <= n; i++) pc = at(c, i);
    for (let i = 0; i <= n; i++) {
      // a は1枚に2ステップかける（c より遅い）
      at(a, i);
      pa = at(a, i);
      if (i <= n / 2) pb = at(b, i);
    }
    const ranked = rankEntrants([
      { name: 'a', color: 0, isPlayer: true, timer: a, ...pa },
      { name: 'b', color: 0, isPlayer: false, timer: b, ...pb },
      { name: 'c', color: 0, isPlayer: false, timer: c, ...pc },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['c', 'a', 'b']);
    expect(ranked[2].total).toBeNull();
    expect(ranked[0].total).toBeLessThan(ranked[1].total!);
  });
});

describe('ordinal', () => {
  it('formats race positions in English', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st',
    ]);
  });
});
