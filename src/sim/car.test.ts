import { describe, expect, it } from 'vitest';
import { VEHICLE_PRESETS } from './vehicle';
import { Car } from './car';
import { createPhysicsWorld, loadRapier } from './physics';

describe('contact with walls and cars', () => {
  const params = VEHICLE_PRESETS.find((v) => v.id === 'r34')!.params;

  /** 前 (+z) へ 25m/s で走りながら左へハンドルを切り続け、2 秒後の速さ。wall なら左に壁がある */
  const run = async (wall: boolean) => {
    const rapier = await loadRapier();
    const boxes = wall ? [{ kind: 'wall' as const, x: 2.5, y: 1, z: 100, hx: 0.25, hy: 1, hz: 200, variant: 0 }] : [];
    const physics = createPhysicsWorld(rapier, { boxes, trees: [], cones: [], signs: [] });
    const car = new Car(physics, { x: 0, z: 0, yaw: 0 }, params);
    car.setVelocity(0, 25);
    for (let i = 0; i < 120; i++) {
      car.applyInput({ throttle: 1, brake: 0, steer: 1 }, 1 / 60);
      physics.world.step();
    }
    return Math.hypot(car.body.linvel().x, car.body.linvel().z);
  };

  it('loses speed while scraping along a wall (no free cornering on the wall)', async () => {
    const free = await run(false);
    const scraping = await run(true);
    expect(scraping).toBeLessThan(free - 8);
  });

  it('loses speed when shoved by another car', async () => {
    const rapier = await loadRapier();
    const physics = createPhysicsWorld(rapier, { boxes: [], trees: [], cones: [], signs: [] });
    const a = new Car(physics, { x: 0, z: 0, yaw: 0 }, params);
    const b = new Car(physics, { x: 2.2, z: 0, yaw: 0 }, params);
    const lone = new Car(physics, { x: 50, z: 0, yaw: 0 }, params);
    for (const c of [a, b, lone]) c.setVelocity(0, 25);
    // a は左（b のいる側）へハンドルを切って b を押し続ける
    for (let i = 0; i < 60; i++) {
      a.applyInput({ throttle: 1, brake: 0, steer: 1 }, 1 / 60);
      b.applyInput({ throttle: 1, brake: 0, steer: 0 }, 1 / 60);
      lone.applyInput({ throttle: 1, brake: 0, steer: 0 }, 1 / 60);
      physics.world.step();
    }
    const speed = (c: Car) => Math.hypot(c.body.linvel().x, c.body.linvel().z);
    expect(speed(a)).toBeLessThan(speed(lone) - 3);
    expect(speed(b)).toBeLessThan(speed(lone) - 1);
  });
});
