import { beforeAll, describe, expect, it } from 'vitest';
import { AKINA_DOWN_MAP, HAPPOGAHARA_MAP, SHUTOKO_MAP } from '../map/maps';
import { LAYER_LOWER, LAYER_UPPER } from '../map/road';
import { type Rapier, loadRapier } from '../sim/physics';
import { Track } from './track';

let rapier: Rapier;

beforeAll(async () => {
  rapier = await loadRapier();
});

/** コースの中心線に沿って、一定の速さで車を進める（ハンドルは向きを直接合わせる） */
function driveAlong(track: Track, from: number, to: number) {
  const course = track.course!;
  const p0 = course.pointAt(from);
  const car = track.createCar({ x: p0.x, z: p0.z, yaw: p0.yaw, s: from });
  let maxImpact = 0;
  const layers = new Set<number>();
  for (let s = from; s < to; s += 0.25) {
    const p = course.pointAt(s);
    car.reset({ x: p.x, z: p.z, yaw: p.yaw, s: car.courseS ?? s });
    car.setVelocity(Math.sin(p.yaw) * 15, Math.cos(p.yaw) * 15);
    car.applyInput({ throttle: 0.3, brake: 0, steer: 0 }, 1 / 60);
    track.physics.world.timestep = 1 / 60;
    track.physics.world.step();
    maxImpact = Math.max(maxImpact, car.measureImpact());
    layers.add(track.layerAt(car.courseS));
  }
  return { car, maxImpact, layers };
}

describe('grade-separated crossings in the physics world', () => {
  it('lets a car on the road below pass under the walls of the loop bridge crossing over it', () => {
    const track = new Track(rapier, HAPPOGAHARA_MAP);
    const road = track.road!;
    const first = road.layer.indexOf(LAYER_LOWER);
    const start = first * road.step - road.spec.start;
    // 橋の壁（上の層）が、下の道路を斜めに横切っている
    const crossing = track.obstacles.boxes.filter((b) => b.layer === LAYER_UPPER).some((b) => {
      for (let i = first; road.layer[i] === LAYER_LOWER; i++) if (Math.hypot(b.x - road.x[i], b.z - road.z[i]) < road.width[i] / 2) return true;
      return false;
    });
    expect(crossing).toBe(true);
    const { maxImpact, layers, car } = driveAlong(track, start, start + 100);
    expect(layers.has(LAYER_LOWER)).toBe(true);
    expect(layers.has(LAYER_UPPER)).toBe(false);
    expect(maxImpact).toBeLessThan(1);
    expect(car.courseS!).toBeGreaterThan(start + 80);
    expect(car.courseS!).toBeLessThan(start + 120);
  });

  it('stacks the rings of the highway loop: the car below stays on the lower ring', () => {
    const track = new Track(rapier, SHUTOKO_MAP);
    const road = track.road!;
    const start = road.layer.indexOf(LAYER_LOWER) * road.step - road.spec.start;
    const { maxImpact, layers, car } = driveAlong(track, start, start + 150);
    expect(layers.has(LAYER_UPPER)).toBe(false);
    expect(maxImpact).toBeLessThan(1);
    const t = car.body.translation();
    expect(track.heightAt(t.x, t.z, car.courseS, undefined, false)).toBeLessThan(track.roadCourse!.heightAt(start + 2 * Math.PI * 55 + 150) - 8);
  });

  it('keeps a car on the loop bridge on the upper layer and finds its height there', () => {
    const track = new Track(rapier, HAPPOGAHARA_MAP);
    const road = track.road!;
    const start = road.layer.indexOf(LAYER_UPPER) * road.step - road.spec.start;
    const { maxImpact, layers, car } = driveAlong(track, start, start + 60);
    expect(layers.has(LAYER_UPPER)).toBe(true);
    expect(maxImpact).toBeLessThan(1);
    const t = car.body.translation();
    // 真下の道路ではなく、橋の上の高さ
    const below = track.roadCourse!.heightAt(road.layer.indexOf(LAYER_LOWER) * road.step - road.spec.start);
    expect(track.heightAt(t.x, t.z, car.courseS, undefined, false)).toBeGreaterThan(below + 8);
  });
});

describe('gutters (溝落とし)', () => {
  it('finds the inside wheels in the gutter on the inside of the Akina hairpins only', () => {
    const track = new Track(rapier, AKINA_DOWN_MAP);
    const course = track.course!;
    const road = track.road!;
    // 5連続ヘアピンの最初の円弧の真ん中
    const pieces = road.spec.pieces;
    const hairpin = pieces.findIndex((p, i) => i > 20 && p.arc?.radius === 16);
    expect(hairpin).toBeGreaterThan(0);
    const s = (road.pieceStart[hairpin] + road.pieceStart[hairpin + 1]) / 2 - road.spec.start;
    const p = course.pointAt(s);
    const inside = Math.sign(road.curvature[road.indexAt(road.pieceStart[hairpin] + 5)]);
    const at = (offset: number) => track.gutterAt(p.x + Math.cos(p.yaw) * offset, p.z - Math.sin(p.yaw) * offset, s);
    const edge = course.widthAt(s) / 2;
    // 内側のタイヤ（車体の中心から 0.82m）が溝の中
    expect(at(inside * (edge - 0.6))).toBe(inside);
    expect(at(0)).toBe(0);
    expect(at(-inside * (edge - 0.6))).toBe(0);
    expect(at(inside * (edge + 1))).toBe(0);
    // 直線には溝がない
    const straight = road.pieceStart[hairpin + 1] + 30 - road.spec.start;
    const q = course.pointAt(straight);
    expect(track.gutterAt(q.x + Math.cos(q.yaw) * inside * (edge - 0.6), q.z - Math.sin(q.yaw) * inside * (edge - 0.6), straight)).toBe(0);
  });
});

describe('Car in a gutter', () => {
  it('turns harder at the same speed while the inside wheels are in the gutter', () => {
    const track = new Track(rapier, AKINA_DOWN_MAP);
    const turn = (hooked: boolean) => {
      const car = track.createCar({ x: 0, z: 0, yaw: 0 });
      car.slope = null;
      car.offRoad = null;
      car.gutter = () => hooked;
      let yawRate = 0;
      for (let i = 0; i < 60; i++) {
        car.setVelocity(Math.sin(car.snapshot().yaw) * 20, Math.cos(car.snapshot().yaw) * 20);
        car.applyInput({ throttle: 0.5, brake: 0, steer: 1 }, 1 / 60);
        yawRate = car.body.angvel().y;
        track.physics.world.timestep = 1 / 60;
        track.physics.world.step();
      }
      car.dispose();
      return yawRate;
    };
    expect(turn(true)).toBeGreaterThan(turn(false) * 1.2);
  });
});
