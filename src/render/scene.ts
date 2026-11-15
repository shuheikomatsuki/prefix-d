import * as THREE from 'three';
import type { Environment, TimeOfDay } from '../game/environment';
import { createReflections } from './reflections';
import { setCourseWetness } from './courseMaterials';
import type { Quality } from './quality';
import { createStars, skyTexture } from './sky';
import { FarMountains } from './farMountains';
import { REMOTE_HEADLIGHTS } from '../game/headlights';

/** 影を描く範囲（車の周りだけ影を計算して軽くする） */
const SHADOW_EXTENT = 50;
/** 画質「高」の影の範囲（影の画像を大きくして、遠くの影も同じ細かさで描く） */
const SHADOW_EXTENT_HIGH = 90;

/** 時間帯ごとの空と光 */
interface Lighting {
  /** 地平線の空の色（霧の色） */
  sky: number;
  /** 真上の空の色 */
  zenith: number;
  /** 太陽（月）のまわりのにじみの色と強さ */
  glow: number;
  glowStrength: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  sunColor: number;
  sun: number;
  /** 太陽（夜は月）の向き（注目点からの位置） */
  sunOffset: THREE.Vector3;
  fogNear: number;
  fogFar: number;
}

const LIGHTING: Record<TimeOfDay, Lighting> = {
  morning: {
    sky: 0xf2c9a4,
    zenith: 0x6f8fc0,
    glow: 0xffb070,
    glowStrength: 1,
    hemiSky: 0xffe3c8,
    hemiGround: 0x5b6a4a,
    hemi: 1.3,
    sunColor: 0xffc68c,
    sun: 2.0,
    sunOffset: new THREE.Vector3(-60, 28, -15),
    fogNear: 120,
    fogFar: 420,
  },
  day: {
    sky: 0xa9d4f5,
    zenith: 0x4a86d4,
    glow: 0xfff6e0,
    glowStrength: 0.9,
    hemiSky: 0xdfefff,
    hemiGround: 0x5b7a4a,
    hemi: 1.6,
    sunColor: 0xfff3dc,
    sun: 2.2,
    sunOffset: new THREE.Vector3(-30, 60, -20),
    fogNear: 150,
    fogFar: 450,
  },
  night: {
    sky: 0x0a0f1f,
    zenith: 0x02040b,
    glow: 0xc8d4ff,
    glowStrength: 0.35,
    hemiSky: 0x5a6aa0,
    hemiGround: 0x10160f,
    hemi: 0.75,
    sunColor: 0xa9b8ff,
    sun: 0.5,
    sunOffset: new THREE.Vector3(30, 60, 25),
    fogNear: 60,
    fogFar: 300,
  },
};

/** 遠くの山並みの、かすむ前の色（朝は逆光で暖かい灰色、夜はほとんど黒） */
const MOUNTAIN_COLORS: Record<TimeOfDay, number> = { morning: 0x5f5a5c, day: 0x3c5a4a, night: 0x04060b };

/** 雨粒の数と、カメラの周りに降らせる範囲 [m] */
const RAIN_DROPS = 1800;
const RAIN_BOX = { x: 70, y: 30, z: 70 };
const RAIN_SPEED = 26;
const RAIN_STREAK = 0.9;

/** 夜にヘッドライトを消したときの、空の光の明るさの割合 */
const NIGHT_LIGHTS_OFF = 0.15;

/** ヘッドライトの光の出る位置と、照らす先（車体から見た位置） */
const HEADLIGHT_FROM = new THREE.Vector3(0, 1.1, 2.0);
const HEADLIGHT_TO = new THREE.Vector3(0, -1.2, 18);

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private sunOffset = LIGHTING.day.sunOffset;
  private readonly fog = new THREE.Fog(LIGHTING.day.sky, LIGHTING.day.fogNear, LIGHTING.day.fogFar);
  /** 自分の車の前を照らすライト（ヘッドライトをつけている間） */
  private readonly headlight = new THREE.SpotLight(0xfff0d0, 0, 120, 0.55, 0.5, 1);
  /** 暗さに合わせたヘッドライトの明るさ（夜 1、朝・雨・霧 0.35、晴れた昼 0.15） */
  private lightLevel = 0;
  private headlightsOn = false;
  /** 時間帯と天気で決まる空の光の明るさ（夜にライトを消すと、これより暗くする） */
  private hemiLevel = LIGHTING.day.hemi;
  private sunLevel = LIGHTING.day.sun;
  private night = false;
  private readonly canvasSize = new THREE.Vector2();
  /** 他の人の車の前を照らすライト（近い車から順に使う。数を変えるとシェーダーを作り直すので、使わない分は暗くしておく） */
  private readonly remoteHeadlights = Array.from({ length: REMOTE_HEADLIGHTS }, () => new THREE.SpotLight(0xfff0d0, 0, 120, 0.55, 0.5, 1));
  private readonly rain: THREE.LineSegments;
  private quality: Quality = 'standard';
  /** 夜の星（カメラと一緒に動かす） */
  private readonly stars = createStars();
  /** 遠くの山並み（カメラと一緒に動かす） */
  private readonly mountains = new FarMountains();
  private mountainsWeather = true;
  private mountainsCourse = true;
  private readonly rainPositions: Float32Array;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    // 影の縁をぼかして、くっきりしすぎないようにする
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene.environment = createReflections(this.renderer);

    this.scene.background = new THREE.Color(LIGHTING.day.sky);
    this.stars.visible = false;
    this.scene.add(this.stars, this.mountains.group);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(LIGHTING.day.hemiSky, LIGHTING.day.hemiGround, LIGHTING.day.hemi);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(LIGHTING.day.sunColor, LIGHTING.day.sun);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -SHADOW_EXTENT;
    cam.right = SHADOW_EXTENT;
    cam.top = SHADOW_EXTENT;
    cam.bottom = -SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.scene.add(this.headlight, this.headlight.target);
    for (const l of this.remoteHeadlights) this.scene.add(l, l.target);

    // 雨: カメラの周りの箱の中を落ちる細い線。箱から出たら上へ戻す
    this.rainPositions = new Float32Array(RAIN_DROPS * 6);
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = (Math.random() - 0.5) * RAIN_BOX.x;
      const y = Math.random() * RAIN_BOX.y;
      const z = (Math.random() - 0.5) * RAIN_BOX.z;
      this.rainPositions.set([x, y, z, x, y + RAIN_STREAK, z], i * 6);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc5d2e0, transparent: true, opacity: 0.55, fog: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  /** 時間帯と天気に合わせて、空・光・霧・雨を変える */
  setEnvironment(env: Environment): void {
    const l = LIGHTING[env.time];
    const sky = new THREE.Color(l.sky);
    let light = 1;
    let near = l.fogNear;
    let far = l.fogFar;
    if (env.weather === 'rain') {
      // 雲が厚く、暗くて遠くがかすむ
      sky.lerp(new THREE.Color(env.time === 'night' ? 0x101418 : 0x7f8a94), 0.7);
      light = 0.6;
      near = 40;
      far = 240;
    } else if (env.weather === 'fog') {
      sky.lerp(new THREE.Color(env.time === 'night' ? 0x22272e : 0xd3d7db), 0.85);
      light = 0.8;
      near = 4;
      far = env.time === 'night' ? 55 : 70;
    }
    // 空: 真上の色は、雨や霧ほど地平線の色（灰色）に近づく。太陽のにじみは晴れの日だけはっきり見える
    const clear = env.weather === 'clear';
    const zenith = new THREE.Color(l.zenith).lerp(sky, clear ? 0 : env.weather === 'rain' ? 0.85 : 0.95);
    const background = skyTexture({
      zenith: zenith.getHex(),
      horizon: sky.getHex(),
      sun: l.sunOffset,
      glow: l.glow,
      glowStrength: l.glowStrength * (clear ? 1 : 0.15),
      // 晴れた朝・昼は白い雲が浮かぶ（朝は朝日の色）。雨・霧・夜は出さない
      clouds: clear && env.time !== 'night' ? 0.55 : 0,
      cloudColor: env.time === 'morning' ? 0xffd9b8 : 0xffffff,
    });
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    this.stars.visible = env.time === 'night' && clear;
    // 遠くの山: 晴れの日は少しかすみ、雨の日はほとんど空に溶け、霧の日は見えない
    this.mountainsWeather = env.weather !== 'fog';
    this.mountains.visible = this.mountainsWeather && this.mountainsCourse;
    this.mountains.setColors(sky, new THREE.Color(MOUNTAIN_COLORS[env.time]), clear ? 0 : 0.6);
    this.scene.background = background;
    this.fog.color.copy(sky);
    this.fog.near = near;
    this.fog.far = far;
    this.hemi.color.setHex(l.hemiSky);
    this.hemi.groundColor.setHex(l.hemiGround);
    this.hemiLevel = l.hemi * light;
    this.sun.color.setHex(l.sunColor);
    // 雨や霧の日は日差しが弱く、影もほとんど出ない
    this.sunLevel = l.sun * (env.weather === 'clear' ? 1 : 0.35);
    this.night = env.time === 'night';
    this.sunOffset = l.sunOffset;
    this.lightLevel = env.time === 'night' ? 1 : env.time === 'morning' || env.weather !== 'clear' ? 0.35 : 0.15;
    this.applyHeadlight();
    this.rain.visible = env.weather === 'rain';
    // 雨の日は路面が濡れてつやが出る（霧の日は少し湿っている）
    setCourseWetness(env.weather === 'rain' ? 1 : env.weather === 'fog' ? 0.3 : 0);
  }

  /** 遠くの山並みを出すか（山の中の峠だけ。街の中の首都高や練習用の街には出さない） */
  setFarMountains(on: boolean): void {
    this.mountainsCourse = on;
    this.mountains.visible = this.mountainsWeather && on;
  }

  /** 自分の車のヘッドライトをつける・消す */
  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    this.applyHeadlight();
  }

  private applyHeadlight(): void {
    // visible を切り替えると、ライトの数が変わってシェーダーを作り直す（一瞬止まる）ので、明るさだけを変える
    this.headlight.intensity = this.headlightsOn ? 2000 * this.lightLevel : 0;
    // 夜にライトを消すと、月明かりだけでほとんど見えない
    const dark = this.night && !this.headlightsOn ? NIGHT_LIGHTS_OFF : 1;
    this.hemi.intensity = this.hemiLevel * dark;
    // 車に映り込む景色の明るさも、空の光に合わせる（夜は暗い）
    this.scene.environmentIntensity = Math.min(1, this.hemiLevel / LIGHTING.day.hemi) * dark * (this.night ? 0.3 : 1);
    this.sun.intensity = this.sunLevel * dark;
  }

  /** 暗くてヘッドライトをつけたほうがよい時間帯・天気か（朝・夜・雨・霧） */
  static needsHeadlights(env: Environment): boolean {
    return env.time !== 'day' || env.weather !== 'clear';
  }

  /** 太陽光（影の範囲）を注目点に追従させる */
  followTarget(x: number, z: number, y = 0): void {
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.sunOffset.x, y + this.sunOffset.y, z + this.sunOffset.z);
  }

  /** ヘッドライトを車に合わせる（root は車体） */
  followCar(root: THREE.Object3D): void {
    if (!this.headlightsOn) return;
    root.updateMatrixWorld();
    this.headlight.position.copy(root.localToWorld(HEADLIGHT_FROM.clone()));
    this.headlight.target.position.copy(root.localToWorld(HEADLIGHT_TO.clone()));
  }

  /** 他の人の車のヘッドライトで前を照らす（cars はライトをつけている近くの車の車体。REMOTE_HEADLIGHTS 台まで） */
  setRemoteHeadlights(cars: readonly THREE.Object3D[]): void {
    this.remoteHeadlights.forEach((light, i) => {
      const root = cars[i];
      light.intensity = root ? 2000 * this.lightLevel : 0;
      if (!root) return;
      root.updateMatrixWorld();
      light.position.copy(root.localToWorld(HEADLIGHT_FROM.clone()));
      light.target.position.copy(root.localToWorld(HEADLIGHT_TO.clone()));
    });
  }

  /** 雨を降らせる（カメラの周りだけ） */
  update(dt: number, camera: THREE.Camera): void {
    this.stars.position.copy(camera.position);
    this.mountains.follow(camera);
    if (!this.rain.visible) return;
    const p = this.rainPositions;
    const fall = RAIN_SPEED * dt;
    for (let i = 0; i < p.length; i += 6) {
      let y = p[i + 1] - fall;
      if (y < 0) y += RAIN_BOX.y;
      p[i + 1] = y;
      p[i + 4] = y + RAIN_STREAK;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rain.position.set(camera.position.x, camera.position.y - RAIN_BOX.y / 2, camera.position.z);
  }

  resize(camera: THREE.PerspectiveCamera): void {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /** 描画先の大きさが画面とずれていたら合わせる（スマホの向きやアドレスバーが変わったのに resize が来ないときのため） */
  fitToWindow(camera: THREE.PerspectiveCamera): void {
    const size = this.renderer.getSize(this.canvasSize);
    if (size.x !== window.innerWidth || size.y !== window.innerHeight) this.resize(camera);
  }

  /** 画質を変える（高: 影を細かく、遠くまで描く） */
  setQuality(quality: Quality): void {
    this.quality = quality;
    const high = quality === 'high';
    this.sun.shadow.mapSize.setScalar(high ? 4096 : 2048);
    const extent = high ? SHADOW_EXTENT_HIGH : SHADOW_EXTENT;
    const cam = this.sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.updateProjectionMatrix();
    // 影の画像の大きさを変えたら、作り直させる
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }

}
