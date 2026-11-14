import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAR_DIMENSIONS } from '../sim/car';
import { ARCH_RADIUS, BELT_Y, BODY_BOTTOM, type BodyShape, SHOULDER_HALF, bodyGeometry, bodyOutline, bodyTop, coreGeometry } from './carBody';
import { CAR_STYLES, CarMesh } from './carMesh';

const shapeOf = (id: string): BodyShape => {
  const s = CAR_STYLES[id];
  return { frontLow: s.window[1], rearLow: s.window[0], nose: s.nose ?? 0.12, tail: s.tail ?? 0.05 };
};
const ids = Object.keys(CAR_STYLES);

describe('car body', () => {
  it('is flat under the windows and drops toward the nose and the tail', () => {
    const shape = shapeOf('s13');
    expect(bodyTop(shape, 0)).toBeCloseTo(BELT_Y);
    expect(bodyTop(shape, shape.frontLow)).toBeCloseTo(BELT_Y);
    expect(bodyTop(shape, 2.0)).toBeLessThan(bodyTop(shape, 1.5));
    expect(bodyTop(shape, -2.0)).toBeLessThan(BELT_Y);
  });

  it.each(ids)('leaves room around the wheels (%s)', (id) => {
    const { wheelRadius, frontAxle, rearAxle } = CAR_DIMENSIONS;
    for (const [z, y] of bodyOutline(shapeOf(id))) {
      for (const axle of [frontAxle, rearAxle]) expect(Math.hypot(z - axle, y - wheelRadius)).toBeGreaterThan(wheelRadius + 0.05);
    }
  });

  it.each(ids)('stays inside the car and under the windows (%s)', (id) => {
    const shape = shapeOf(id);
    const box = new THREE.Box3().setFromBufferAttribute(bodyGeometry(shape).getAttribute('position') as THREE.BufferAttribute);
    expect(box.max.x).toBeLessThanOrEqual(CAR_DIMENSIONS.width / 2 + 1e-6);
    expect(box.max.z).toBeLessThanOrEqual(CAR_DIMENSIONS.length / 2 + 1e-6);
    expect(box.min.z).toBeGreaterThanOrEqual(-CAR_DIMENSIONS.length / 2 - 1e-6);
    expect(box.max.y).toBeLessThanOrEqual(BELT_Y + 1e-6);
    expect(box.min.y).toBeGreaterThanOrEqual(BODY_BOTTOM - 1e-6);
    // タイヤハウスの上の細い所も、縁の丸みで裏返らない
    expect(BELT_Y - (CAR_DIMENSIONS.wheelRadius + ARCH_RADIUS)).toBeGreaterThan(0.05);
    // 窓の下の線の上面は、窓を置ける幅がある
    expect(SHOULDER_HALF).toBeGreaterThan(0.8);
  });

  it.each(ids)('hides the dark core inside the body (%s)', (id) => {
    const shape = shapeOf(id);
    const pos = coreGeometry(shape, 0.55).getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeLessThan(bodyTop(shape, pos.getZ(i)));
  });

  it.each(ids)('builds every car (%s)', (id) => {
    const mesh = new CarMesh(undefined, CAR_STYLES[id]);
    expect(mesh.root.children.length).toBeGreaterThan(10);
    mesh.dispose();
  });
});
