import type RAPIER from '@dimforge/rapier3d';
import type { MapObstacles } from '../map/obstacles';

export type Rapier = typeof RAPIER;

let ready: Promise<Rapier> | null = null;

/**
 * Rapier（WASM）を読み込む。何度呼んでも1回だけ実行される。
 * 別ファイルに分けて後から読み込むので、ゲーム本体の JS が軽くなり、WASM はそのままの形でストリーミングでコンパイルされる
 */
export function loadRapier(): Promise<Rapier> {
  ready ??= import('@dimforge/rapier3d').then((m) => m.default);
  return ready;
}

/**
 * 立体交差の層ごとの衝突のグループ（上位 16 ビットが属するグループ、下位 16 ビットがぶつかる相手）。
 * 層のない壁や地面・建物はすべての車とぶつかり、層のある壁は同じ層（または層のない所）を走る車とだけぶつかる。
 * 車どうしも、違う層を走っていればぶつからない
 */
export function wallGroups(layer: number): number {
  return ((layer & 0xffff) << 16) | 0xffff;
}

export function carGroups(layer: number): number {
  // 層のない所を走る車は、上と下の両方の層に属する
  const bits = layer === 0 ? 3 : layer;
  return (bits << 16) | bits;
}

export interface ConeBody {
  body: RAPIER.RigidBody;
}

export const CONE_HALF_SIZE = { radius: 0.25, height: 0.4 };
export const SIGN_POLE = { radius: 0.08, height: 2.6 };

export interface PhysicsWorld {
  rapier: Rapier;
  world: RAPIER.World;
  cones: ConeBody[];
}

/** 地面・建物・壁・木・コーンの衝突体を持つ物理ワールドを作る */
export function createPhysicsWorld(rapier: Rapier, obstacles: MapObstacles): PhysicsWorld {
  const world = new rapier.World({ x: 0, y: -9.81, z: 0 });

  // 地面（十分に広い板。中心線で描く道路のマップは数 km 先まで続く）
  const ground = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(rapier.ColliderDesc.cuboid(20000, 0.5, 20000), ground);

  for (const b of obstacles.boxes) {
    const yaw = b.yaw ?? 0;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed()
        .setTranslation(b.x, b.y, b.z)
        .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
    );
    const desc = rapier.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setFriction(0.1);
    if (b.layer) desc.setCollisionGroups(wallGroups(b.layer));
    world.createCollider(desc, body);
  }

  for (const t of obstacles.trees) {
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(t.x, t.height / 2, t.z),
    );
    world.createCollider(rapier.ColliderDesc.cylinder(t.height / 2, t.trunkRadius), body);
  }

  for (const sign of obstacles.signs) {
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(sign.x, SIGN_POLE.height / 2, sign.z),
    );
    world.createCollider(rapier.ColliderDesc.cylinder(SIGN_POLE.height / 2, SIGN_POLE.radius), body);
  }

  const cones = obstacles.cones.map((c) => {
    const { radius, height } = CONE_HALF_SIZE;
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
        .setTranslation(c.x, height, c.z)
        .setLinearDamping(0.5)
        .setAngularDamping(0.5),
    );
    world.createCollider(
      rapier.ColliderDesc.cylinder(height, radius).setMass(4).setFriction(0.6),
      body,
    );
    return { body };
  });

  return { rapier, world, cones };
}
