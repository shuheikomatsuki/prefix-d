import * as THREE from 'three';

/**
 * リプレイだけで使う、外から車を撮る視点（TV中継・横から・前から・上空）。
 * 運転中の視点（三人称・運転席）は CameraRig のまま使う
 */

export type ReplayViewId = 'tv' | 'side' | 'front' | 'heli';

export const REPLAY_VIEWS: readonly { id: ReplayViewId; name: string }[] = [
  { id: 'tv', name: 'TV中継' },
  { id: 'side', name: '横から' },
  { id: 'front', name: '前から' },
  { id: 'heli', name: '上空' },
];

/** 車の位置と向き（y は路面の高さ） */
export interface CamPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/** TV中継のカメラを、何秒先の車の位置の脇に置くか */
export const TV_LEAD = 2;
/** TV中継のカメラを車の通る線からどれだけ横に置くか [m]（離しすぎると道ばたの木に隠れる） */
export const TV_OFFSET = 5;
const TV_HEIGHT = 4;

/** 車が来る所（future）の脇に、TV中継のカメラを置く。side は 1 で左、-1 で右 */
export function placeStation(future: CamPose, side: 1 | -1): Point3 {
  return {
    x: future.x + Math.cos(future.yaw) * TV_OFFSET * side,
    y: future.y + TV_HEIGHT,
    z: future.z - Math.sin(future.yaw) * TV_OFFSET * side,
  };
}

/** 車がカメラの前を通り過ぎて遠ざかった（か、遠すぎる）なら、次のカメラに切り替える */
export function stationPassed(station: Point3, car: CamPose): boolean {
  const dx = station.x - car.x;
  const dz = station.z - car.z;
  const d = Math.hypot(dx, dz);
  const ahead = dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw);
  return (ahead < 0 && d > 30) || d > 160;
}

/** TV中継で、離れた車も同じくらいの大きさに映るよう寄せる（視野角 [deg]） */
export function tvFov(distance: number): number {
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(7 / Math.max(1, distance))), 10, 60);
}

export class ReplayCamera {
  private station: Point3 | null = null;
  private side: 1 | -1 = 1;
  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private initialized = false;

  /** 視点を変えた・シークした・追いかける車を変えたとき。次のコマで一気に目標へ */
  reset(): void {
    this.station = null;
    this.initialized = false;
  }

  /** future(sec): 追いかけている車の sec 秒先の位置（TV中継のカメラを置く所） */
  update(id: ReplayViewId, car: CamPose, future: (sec: number) => CamPose | null, camera: THREE.PerspectiveCamera, frameDt: number): void {
    const fx = Math.sin(car.yaw);
    const fz = Math.cos(car.yaw);
    const lx = fz;
    const lz = -fx;
    const target = new THREE.Vector3(car.x, car.y + 0.8, car.z);
    let pos: THREE.Vector3;
    let look = target;
    let fov = 50;
    let smooth = 5;
    switch (id) {
      case 'tv': {
        if (!this.station || stationPassed(this.station, car)) {
          this.side = this.side === 1 ? -1 : 1;
          this.station = placeStation(future(TV_LEAD) ?? car, this.side);
          this.initialized = false;
        }
        pos = new THREE.Vector3(this.station.x, this.station.y, this.station.z);
        fov = tvFov(pos.distanceTo(target));
        // 据え置きのカメラが首を振って追う
        smooth = 0;
        break;
      }
      case 'side':
        pos = new THREE.Vector3(car.x + lx * 6, car.y + 1.3, car.z + lz * 6);
        fov = 55;
        break;
      case 'front':
        pos = new THREE.Vector3(car.x + fx * 8, car.y + 1.6, car.z + fz * 8);
        fov = 55;
        smooth = 8;
        break;
      case 'heli':
        pos = new THREE.Vector3(car.x - fx * 22, car.y + 30, car.z - fz * 22);
        look = new THREE.Vector3(car.x + fx * 10, car.y, car.z + fz * 10);
        fov = 50;
        smooth = 2.5;
        break;
    }
    if (!this.initialized || smooth === 0) {
      this.position.copy(pos);
      if (!this.initialized) this.lookAt.copy(look);
      this.initialized = true;
    } else {
      this.position.lerp(pos, 1 - Math.exp(-smooth * frameDt));
    }
    // 視線は位置より速く追う（車が画面から外れないように）
    this.lookAt.lerp(look, 1 - Math.exp(-14 * frameDt));
    camera.position.copy(this.position);
    camera.lookAt(this.lookAt);
    if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== 0.3) {
      camera.fov = fov;
      camera.near = 0.3;
      camera.updateProjectionMatrix();
    }
  }
}
