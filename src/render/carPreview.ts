import * as THREE from 'three';
import { CarMesh, carStyle } from './carMesh';
import { createReflections } from './reflections';

/**
 * メニューの車の見た目: 回る台の上の車を、小さな別の canvas に描く。
 * 1 つだけ作って、車を選ぶ画面・ライバルの画面のどこにでも付け替えて使う
 */
export class CarPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private car: CarMesh | null = null;
  private carId = '';
  private frame = 0;
  private angle = -0.6;
  private last = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'car-preview';
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2622, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 6, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffb27a, 1.1);
    rim.position.set(-5, 2, -4);
    this.scene.add(rim);
    // 台: 暗い円盤と、縁の細い光る輪
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshBasicMaterial({ color: 0x15181d }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.32, 3.4, 96), new THREE.MeshBasicMaterial({ color: 0xff4a1c }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.camera.position.set(0, 2.3, 8.6);
    this.camera.lookAt(0, 0.55, 0);
  }

  /** WebGL が使えなければ false（そのときは見た目を出さない） */
  private ensureRenderer(): boolean {
    if (this.renderer) return true;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.scene.environment = createReflections(this.renderer);
      return true;
    } catch {
      return false;
    }
  }

  /** container の中に置いて、その車を回して見せる */
  show(container: HTMLElement, carId: string): void {
    if (!this.ensureRenderer()) return;
    if (this.canvas.parentElement !== container) container.appendChild(this.canvas);
    if (carId !== this.carId) {
      if (this.car) {
        this.scene.remove(this.car.root);
        this.car.dispose();
      }
      this.car = new CarMesh(undefined, carStyle(carId));
      this.car.update({ x: 0, y: 0, z: 0, yaw: 0, forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0.18, wheelSpin: 0 });
      this.scene.add(this.car.root);
      this.carId = carId;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  /** 画面から外して、描くのをやめる */
  hide(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.canvas.remove();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent || !this.renderer) return;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 横長の枠でも縦長の枠でも、車が収まる距離にする
    const dist = 7.2 / Math.min(1, this.camera.aspect / 1.4);
    this.camera.position.set(0, 2.1 * (dist / 7.2), dist);
    this.camera.lookAt(0, 0.45, 0);
    this.camera.updateProjectionMatrix();
  }

  private readonly tick = (now: number) => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.angle += dt * 0.5;
    if (this.car) this.car.root.rotation.y = this.angle;
    this.renderer?.render(this.scene, this.camera);
  };
}
