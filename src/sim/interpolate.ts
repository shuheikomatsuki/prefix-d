import type { CarSnapshot } from './car';

/** 2つのスナップショットの間を補間する（描画を物理ステップより滑らかにするため） */
export function lerpSnapshot(a: CarSnapshot, b: CarSnapshot, t: number): CarSnapshot {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  let dyaw = b.yaw - a.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  return {
    ...b,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    z: lerp(a.z, b.z),
    yaw: a.yaw + dyaw * t,
    wheelSpin: lerp(a.wheelSpin, b.wheelSpin),
  };
}
