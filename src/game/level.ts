import * as THREE from 'three';
import type { MapDefinition } from '../map/tilemap';
import { buildMapMesh, buildShortcutMesh, createConeMesh } from '../render/mapMesh';
import { buildRaceLines } from '../render/raceMesh';
import { buildRoadMesh } from '../render/roadMesh';
import type { Car, CarSnapshot } from '../sim/car';
import type { Rapier } from '../sim/physics';
import { Track } from './track';

/** 内側のタイヤを側溝に落としているときの、車体の沈み [m] と傾き [rad] */
const GUTTER_SINK = 0.05;
const GUTTER_ROLL = 0.06;

/** 1つのマップの物理ワールド・車・描画物をまとめたもの。マップ切り替え時に作り直す */
export class Level extends Track {
  readonly car: Car;
  readonly group = new THREE.Group();
  private readonly coneMeshes: THREE.Mesh[];

  constructor(rapier: Rapier, def: MapDefinition) {
    super(rapier, def);
    this.car = this.createCar(this.spawn);

    if (this.road) this.group.add(buildRoadMesh(this.road, this.obstacles, this.roadGround));
    else this.group.add(buildMapMesh(this.map, this.obstacles, this.terrain));
    const surface = this.hasSlopes ? { heightAt: (x: number, z: number) => this.heightAt(x, z, 0), gradientAt: (x: number, z: number) => this.gradientAt(x, z, 0) } : null;
    if (this.course) this.group.add(buildRaceLines(this.course, surface));
    if (this.shortcuts.length) {
      this.group.add(buildShortcutMesh(this.shortcuts, (x, z) => this.heightAt(x, z, null, undefined, false), (x, z) => this.offRoadDistance(x, z)! < 0));
    }
    this.coneMeshes = this.physics.cones.map(() => {
      const m = createConeMesh();
      this.group.add(m);
      return m;
    });
  }

  /**
   * 物理（平ら）での車の状態を、描画用に地形の上へ載せる。
   * 高さを足し、坂の勾配に合わせて車体を前後・左右に傾ける
   */
  ground(s: CarSnapshot): CarSnapshot {
    if (!this.hasSlopes) return s;
    const g = this.gradientAt(s.x, s.z, s.courseS, s.yaw);
    const sin = Math.sin(s.yaw);
    const cos = Math.cos(s.yaw);
    // 内側のタイヤを側溝に落としている間は、その側へ少し傾いて沈む
    const gutter = this.road ? this.gutterAt(s.x, s.z, s.courseS) : 0;
    return {
      ...s,
      y: s.y + this.heightAt(s.x, s.z, s.courseS, s.yaw) - Math.abs(gutter) * GUTTER_SINK,
      // 前方 (sin, cos)・左 (cos, -sin) の向きの勾配
      pitch: Math.atan(g.x * sin + g.z * cos),
      roll: Math.atan(g.x * cos - g.z * sin) - gutter * GUTTER_ROLL,
    };
  }

  /** 動く小物（コーン）の見た目を物理に合わせる */
  syncProps(): void {
    this.physics.cones.forEach((c, i) => {
      const t = c.body.translation();
      const r = c.body.rotation();
      this.coneMeshes[i].position.set(t.x, t.y + (this.terrain?.heightAt(t.x, t.z) ?? 0), t.z);
      this.coneMeshes[i].quaternion.set(r.x, r.y, r.z, r.w);
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    const materials = new Set<THREE.Material>();
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => materials.add(m));
      }
    });
    for (const m of materials) {
      // コースの質感付きの材質は、次のコースでも使い回す
      if (m.userData.shared) continue;
      if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose();
      m.dispose();
    }
    this.physics.world.free();
  }
}
