import * as THREE from 'three';
import { CAR_DIMENSIONS, type CarSnapshot } from '../sim/car';
import { ARCH_RADIUS, BELT_Y, BODY_BOTTOM, type BodyShape, SHOULDER_HALF, bodyGeometry, bodyTaper, coreGeometry, bodyTop, faceTop } from './carBody';

/** 車内の座標（車体ローカル、前方 +Z・左 +X）。右ハンドルなので運転席は -X 側 */
export const CABIN = {
  driverEye: new THREE.Vector3(-0.4, 1.26, -0.2),
  // 助手席の視点は背もたれ寄りにして、運転席のキャラクターが視界に入るようにする
  passengerEye: new THREE.Vector3(0.38, 1.24, -0.38),
};

/** ハンドルの回転量 / 前輪の舵角（見た目用の比率） */
const STEERING_RATIO = 6;

/** 座面の高さ */
export const SEAT_Y = BELT_Y + 0.11;

/** 左右のタイヤの間の、つながった車体の半分の幅 [m]（その外側がタイヤハウス） */
const CORE_HALF = 0.55;
/** 窓が上へ向かって内側に傾く量（屋根の高さで、窓の下の線よりこれだけ内側） [m] */
const TUMBLEHOME = 0.08;
/** 前後の面で、角の丸みにかからずにランプを付けられる半分の幅 [m] */
const FACE_HALF = 0.8;

/** 車種ごとの見た目（当たり判定の大きさはどの車も同じで、形と色だけを変える） */
export interface CarStyle {
  /** 屋根の高さ [m] */
  roof: number;
  /** 窓の前後の位置（側面から見た z）。後ろ下・前下・前上・後ろ上 */
  window: [rearLow: number, frontLow: number, frontHigh: number, rearHigh: number];
  /** 後ろの羽（リアウイング） */
  wing?: 'low' | 'high';
  /** ツートンの下半分の色（パンダトレノなど） */
  lowerColor?: number;
  /** 丸いテールランプ（左右に2つずつ） */
  roundTail?: boolean;
  /** 丸いテールランプの半径 [m]（内側・外側） */
  tailRadii?: [inner: number, outer: number];
  /** 一人で走るときのボディの色 */
  color: number;
  /** 見た目の大きさの倍率（小さな車。当たり判定は変えない） */
  scale?: number;
  /** 2人乗り（後ろの席を置かない） */
  twoSeater?: boolean;
  /** 丸いヘッドライト */
  roundHead?: boolean;
  /** リトラクタブル（ライトをつけるとボンネットから起き上がる）ヘッドライト */
  popUp?: boolean;
  /** 窓と屋根を、ボディの側面からこれだけ内側に寄せる [m]（屋根のすぼまったオープンカーなど） */
  cabinInset?: number;
  /** 鼻先が窓の下の線からどれだけ下がるか [m]（ボンネットの傾き。書かなければ 0.12） */
  nose?: number;
  /** お尻が窓の下の線からどれだけ下がるか [m]（トランクの傾き。書かなければ 0.05） */
  tail?: number;
}

const DEFAULT_STYLE: CarStyle = { roof: 1.42, window: [-1.5, 0.95, 0.4, -1.15], color: 0xd94141 };

/** 車の id ごとの見た目 */
export const CAR_STYLES: Record<string, CarStyle> = {
  standard: DEFAULT_STYLE,
  kei: { roof: 1.56, window: [-1.8, 0.95, 0.6, -1.72], color: 0x8fc7e8, nose: 0.16, tail: 0.03 },
  // 全長 3.3m・全幅 1.4m の小さな2人乗り。長いボンネットの後ろに、低く短いハードトップ
  cappuccino: { roof: 1.4, window: [-1.4, 0.72, -0.12, -1.05], color: 0xdc3a5c, scale: 0.76, twoSeater: true, roundHead: true, cabinInset: 0.16 },
  ae85: { roof: 1.4, window: [-1.6, 0.95, 0.35, -1.0], lowerColor: 0x1d1d1f, color: 0xf2f2ee },
  ae86: { roof: 1.4, window: [-1.95, 0.95, 0.35, -1.05], lowerColor: 0x1d1d1f, color: 0xf2f2ee },
  eg6: { roof: 1.38, window: [-2.0, 0.95, 0.35, -1.85], color: 0xc8202a, nose: 0.15, tail: 0.03 },
  ek9: { roof: 1.4, window: [-2.0, 0.95, 0.35, -1.85], wing: 'low', color: 0xf3d41c, nose: 0.15, tail: 0.03 },
  s13: { roof: 1.32, window: [-1.6, 1.0, 0.25, -0.85], color: 0x1a9e74, nose: 0.15 },
  s14: { roof: 1.34, window: [-1.65, 1.0, 0.25, -0.9], wing: 'low', color: 0xe2601f, nose: 0.14 },
  // 白いエボIV（屋根の高いセダンに大きなウイング）と見分けやすいよう、屋根が低く、後ろの窓を寝かせた小さなウイングのクーペ
  fc3s: { roof: 1.3, window: [-1.95, 1.0, 0.22, -0.8], wing: 'low', popUp: true, color: 0xf6f6f2, nose: 0.16 },
  fd3s: { roof: 1.34, window: [-1.8, 1.05, 0.15, -0.7], wing: 'low', color: 0xf2c318, nose: 0.2, tail: 0.08 },
  evo3: { roof: 1.43, window: [-1.45, 0.95, 0.4, -1.1], wing: 'high', color: 0x141517 },
  evo: { roof: 1.43, window: [-1.45, 0.95, 0.4, -1.1], wing: 'high', color: 0xe9ecef },
  gtr: { roof: 1.37, window: [-1.6, 0.98, 0.3, -0.9], wing: 'low', roundTail: true, color: 0x2a2c30 },
  r34: { roof: 1.38, window: [-1.55, 0.98, 0.3, -0.95], wing: 'high', roundTail: true, tailRadii: [0.08, 0.125], color: 0x8c8558 },
};

export function carStyle(carId: string): CarStyle {
  return CAR_STYLES[carId] ?? DEFAULT_STYLE;
}

/**
 * その車の運転席の目の位置（車体ローカル、大きさの倍率をかける前）。
 * 屋根の前の縁が視界の上をふさがないよう、縁より 0.3m 後ろ・0.18m 下に収める（屋根の低い車では目を下げる）。
 * それだとフロントガラスから大きく離れてしまう車（窓の小さいカプチーノ）は、ダッシュボードと車内の床が
 * 画面の下を大きくふさぐので、ガラスの 0.15m 内側まで前に出す（屋根の縁は目より後ろになって見えない）
 */
export function driverEyeFor(style: CarStyle): THREE.Vector3 {
  const [, frontLow, frontHigh] = style.window;
  const y = Math.min(CABIN.driverEye.y, style.roof - 0.18);
  // 目の高さでのフロントガラスの前後の位置
  const glassZ = frontLow + ((y - BELT_Y) / (style.roof - BELT_Y)) * (frontHigh - frontLow);
  const nearGlass = Math.min(0.05, glassZ - 0.15);
  const belowEdge = Math.min(0.05, frontHigh - 0.3);
  return new THREE.Vector3(CABIN.driverEye.x, y, nearGlass - belowEdge > 0.3 ? nearGlass : belowEdge);
}

/** 2点を結ぶ細い棒（3 次元。左右に傾いたピラーなど） */
function bar(mat: THREE.Material, from: THREE.Vector3, to: THREE.Vector3, thickness: number): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, dir.length(), thickness), mat);
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

/** 4つの角を結ぶ板（窓ガラス）。a → b → c → d の順に一周する */
function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b, c, a, c, d]);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 高さ split より下を lowerColor で塗る（パンダトレノなどのツートン）。
 * 高さは車体ローカルの座標で比べるので、その材質はボディの形（車体ローカルに置いた形）だけに使う
 */
function twoTone(mat: THREE.MeshPhysicalMaterial, lowerColor: number, split: number): void {
  const lower = new THREE.Color(lowerColor);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.lowerColor = { value: lower };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBodyY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyY = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBodyY;\nuniform vec3 lowerColor;')
      .replace('#include <color_fragment>', `#include <color_fragment>\nif (vBodyY < ${split.toFixed(3)}) diffuseColor.rgb = lowerColor;`);
  };
  mat.customProgramCacheKey = () => `two-tone-${split}`;
}

/** 車の塗装: つやのあるクリア塗装（まわりの景色が映り込む） */
function paintMaterial(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.07 });
}

/**
 * ランプの色。消えているときはまわりの光で照らされるだけの色（夜は暗く見える）、
 * ついているときは自分で光る色を足す
 */
const LIGHT_COLORS = { headOff: 0xb9bdb9, headOn: 0xfffbea, tailOff: 0x7a1414, tailOn: 0xff2a1e };

/** リトラクタブルヘッドライトが起き上がる高さ [m] と、起き上がる・閉じるのにかかる時間 [s] */
const POP_UP_HEIGHT = 0.16;
const POP_UP_SECONDS = 0.35;

/**
 * 乗用車のモデル。丸みのあるボディ（src/render/carBody.ts）に、窓・屋根・ランプ・グリル・ホイールなどを付ける。
 * 前輪の舵角・タイヤの回転・ハンドルの回転を反映する
 */
export class CarMesh {
  private headMat: THREE.MeshStandardMaterial | null = null;
  private tailMat: THREE.MeshStandardMaterial | null = null;
  private lightsOn = false;
  /** リトラクタブルヘッドライト（起き上がる部分）と、どれだけ起き上がっているか（0 = 閉じている、1 = 開いている） */
  private readonly popUps: THREE.Group[] = [];
  private popUpBase = BELT_Y;
  private popUp = 0;
  private lastUpdate: number | null = null;
  readonly root = new THREE.Group();
  private readonly frontPivots: THREE.Group[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  private readonly steeringWheel = new THREE.Group();
  /** 塗装（ボディの形のツートン用と、それ以外の部品用） */
  private readonly paints: THREE.MeshPhysicalMaterial[];

  private readonly style: CarStyle;
  private readonly shape: BodyShape;
  private readonly roofY: number;
  private readonly windowProfile: [number, number][];
  /** 窓の下の線と、屋根の高さでの、窓の半分の幅 */
  private readonly cabinHalf: number;
  private readonly roofHalf: number;

  constructor(color?: number, style: CarStyle = DEFAULT_STYLE) {
    this.style = style;
    this.roofY = style.roof;
    const [rearLow, frontLow, frontHigh, rearHigh] = style.window;
    this.windowProfile = [
      [rearLow, BELT_Y],
      [frontLow, BELT_Y],
      [frontHigh, style.roof],
      [rearHigh, style.roof],
    ];
    this.shape = { frontLow, rearLow, nose: style.nose ?? 0.12, tail: style.tail ?? 0.05 };
    this.cabinHalf = SHOULDER_HALF - 0.01 - (style.cabinInset ?? 0);
    this.roofHalf = this.cabinHalf - TUMBLEHOME;
    const paint = paintMaterial(color ?? style.color);
    const bodyPaint = paintMaterial(color ?? style.color);
    // ツートンの境目は、タイヤハウスの上端より少し下
    if (style.lowerColor !== undefined) twoTone(bodyPaint, style.lowerColor, CAR_DIMENSIONS.wheelRadius + 0.19);
    this.paints = [paint, bodyPaint];
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.65 });
    const trim = new THREE.MeshLambertMaterial({ color: 0x2b2d31 });
    this.buildBody(bodyPaint, paint, dark);
    this.buildCabin(paint, dark);
    this.buildInterior(trim);
    this.buildWheels();
    this.root.scale.setScalar(style.scale ?? 1);
  }

  private buildBody(bodyPaint: THREE.Material, paint: THREE.Material, dark: THREE.Material): void {
    const { width, length } = CAR_DIMENSIONS;
    const body = new THREE.Mesh(bodyGeometry(this.shape), bodyPaint);
    body.castShadow = true;
    this.root.add(body);
    // 左右のタイヤの間の、暗い箱（タイヤハウスの奥。えぐった所から見える）
    this.root.add(new THREE.Mesh(coreGeometry(this.shape, CORE_HALF), dark));

    const front = length / 2;
    const rear = -length / 2;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xeeeee4, roughness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xd4d7dc, metalness: 0.9, roughness: 0.25 });

    // 前: ヘッドライト・グリル・ナンバー・左右の空気取り入れ口
    const headY = faceTop(this.shape, true) - 0.065;
    const plateY = BODY_BOTTOM + 0.17;
    add(new THREE.BoxGeometry(0.34, 0.11, 0.02), plateMat, 0, plateY, front + 0.005);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.34, 0.08, 0.04), dark, s * 0.55, BODY_BOTTOM + 0.07, front);
    if (headY - 0.03 > plateY + 0.06) add(new THREE.BoxGeometry(0.62, 0.06, 0.04), dark, 0, headY, front);
    // 後ろ: ナンバー・下の黒い帯・マフラー
    const tailY = faceTop(this.shape, false) - 0.06;
    add(new THREE.BoxGeometry(0.34, 0.11, 0.02), plateMat, 0, Math.min(tailY - 0.13, BODY_BOTTOM + 0.25), rear - 0.005);
    add(new THREE.BoxGeometry(1.3, 0.07, 0.04), dark, 0, BODY_BOTTOM + 0.05, rear);
    const pipe = add(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 12).rotateX(Math.PI / 2), chrome, -0.5, BODY_BOTTOM + 0.06, rear - 0.01);
    pipe.castShadow = false;

    const lightGeo = new THREE.BoxGeometry(0.34, 0.12, 0.05);
    const [innerR, outerR] = this.style.tailRadii ?? [0.1, 0.1];
    const roundGeo = (r: number) => new THREE.CylinderGeometry(r, r, 0.05, 20).rotateX(Math.PI / 2);
    const tailGeos = [roundGeo(innerR), roundGeo(outerR)];
    const headMat = new THREE.MeshStandardMaterial({ color: LIGHT_COLORS.headOff, roughness: 0.12, metalness: 0.4 });
    const tailMat = new THREE.MeshStandardMaterial({ color: LIGHT_COLORS.tailOff, roughness: 0.2 });
    this.headMat = headMat;
    this.tailMat = tailMat;
    const popZ = front - 0.3;
    this.popUpBase = bodyTop(this.shape, popZ);
    for (const s of [-1, 1]) {
      if (this.style.popUp) {
        // 閉じているときは上面だけがボンネットと同じ高さに見え、ライトをつけると起き上がって前にランプが見える
        const pod = new THREE.Group();
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.42, POP_UP_HEIGHT + 0.01, 0.28), paint);
        lid.position.y = -(POP_UP_HEIGHT + 0.01) / 2;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.02), headMat);
        lamp.position.set(0, -0.075, 0.141);
        pod.add(lid, lamp);
        pod.position.set(s * (FACE_HALF - 0.28), this.popUpBase + 0.006, popZ);
        this.root.add(pod);
        this.popUps.push(pod);
        // 閉じたライトの下の、小さな車幅灯
        add(new THREE.BoxGeometry(0.22, 0.05, 0.04), headMat, s * (FACE_HALF - 0.2), headY, front);
      } else {
        add(this.style.roundHead ? roundGeo(0.12) : lightGeo, headMat, s * (FACE_HALF - 0.2), headY, front + 0.005);
      }
      if (this.style.roundTail) {
        // 丸いテールランプを左右に2つずつ
        // 外側の中心は、ランプの縁が車体の端から少し内側に来る位置
        const outerDx = Math.max(0.17, outerR + 0.05);
        [outerDx + outerR + innerR + 0.06, outerDx].forEach((dx, i) => {
          add(tailGeos[i], tailMat, s * (FACE_HALF - dx), tailY, rear - 0.005);
        });
      } else {
        add(lightGeo, tailMat, s * (FACE_HALF - 0.2), tailY, rear - 0.005);
      }

      // ドアの継ぎ目と取っ手（ボディの側面に沿う細い線）
      const sideX = (y: number, z: number) => s * ((width / 2) * bodyTaper(y, z) + 0.002);
      const y0 = BODY_BOTTOM + 0.08;
      const y1 = BELT_Y - 0.1;
      const doorFront = Math.min(this.shape.frontLow - 0.05, CAR_DIMENSIONS.frontAxle - ARCH_RADIUS - 0.04);
      const doorRear = -0.5;
      for (const z of [doorFront, doorRear]) {
        this.root.add(bar(dark, new THREE.Vector3(sideX(y0, z), y0, z), new THREE.Vector3(sideX(y1, z), y1, z), 0.008));
      }
      const handleY = BELT_Y - 0.14;
      const handle = add(new THREE.BoxGeometry(0.02, 0.03, 0.13), dark, sideX(handleY, doorRear + 0.15), handleY, doorRear + 0.15);
      handle.castShadow = false;

      // ドアミラー: 腕と、塗装した箱と、後ろ向きの鏡
      const mx = s * (this.cabinHalf + 0.12);
      add(new THREE.BoxGeometry(0.12, 0.03, 0.05), dark, s * (this.cabinHalf + 0.04), BELT_Y + 0.07, 0.78);
      add(new THREE.BoxGeometry(0.17, 0.1, 0.08), paint, mx, BELT_Y + 0.1, 0.75);
      add(new THREE.BoxGeometry(0.14, 0.075, 0.005), chrome, mx, BELT_Y + 0.1, 0.708);
    }

    if (this.style.wing) {
      // リアウイング: 2本の支柱の上に板（トランクの上に立てる）
      const h = this.style.wing === 'high' ? 0.32 : 0.14;
      const z = rear + 0.22;
      const deck = bodyTop(this.shape, z);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16, 0.035, 0.28), paint);
      blade.position.set(0, deck + h, z);
      blade.castShadow = true;
      this.root.add(blade);
      for (const s of [-1, 1]) {
        add(new THREE.BoxGeometry(0.04, h, 0.12), dark, s * (width / 2 - 0.38), deck + h / 2, z);
        // 翼端板
        add(new THREE.BoxGeometry(0.015, 0.09, 0.3), paint, s * (width / 2 - 0.08), deck + h + 0.02, z);
      }
    }
  }

  private buildCabin(paint: THREE.Material, dark: THREE.Material): void {
    // 薄く色の付いたガラス。まわりの景色がうっすら映り込む（車内から前が見えるよう、映り込みは控えめ）
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x9cc0d6,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      side: THREE.DoubleSide,
      roughness: 0.05,
      metalness: 0,
      envMapIntensity: 0.7,
    });
    const [rearLow, frontLow, frontHigh, rearHigh] = this.windowProfile;
    const roofY = this.roofY;
    const low = this.cabinHalf;
    const high = this.roofHalf;
    const v = (x: number, [z, y]: [number, number]) => new THREE.Vector3(x, y, z);

    // 側面の窓（台形。上ほど内側に傾く）・フロントガラス・リアガラス
    for (const s of [-1, 1]) {
      this.root.add(new THREE.Mesh(quad(v(s * low, rearLow), v(s * low, frontLow), v(s * high, frontHigh), v(s * high, rearHigh)), glass));
    }
    this.root.add(new THREE.Mesh(quad(v(-low, frontLow), v(low, frontLow), v(high, frontHigh), v(-high, frontHigh)), glass));
    this.root.add(new THREE.Mesh(quad(v(-low, rearLow), v(low, rearLow), v(high, rearHigh), v(-high, rearHigh)), glass));

    // 屋根: 角と縁を丸めた板
    const roofShape = new THREE.Shape();
    const hx = high + 0.02;
    const z0 = rearHigh[0] - 0.04;
    const z1 = frontHigh[0] + 0.04;
    const r = 0.08;
    roofShape.moveTo(-hx + r, -z1);
    roofShape.lineTo(hx - r, -z1);
    roofShape.quadraticCurveTo(hx, -z1, hx, -z1 + r);
    roofShape.lineTo(hx, -z0 - r);
    roofShape.quadraticCurveTo(hx, -z0, hx - r, -z0);
    roofShape.lineTo(-hx + r, -z0);
    roofShape.quadraticCurveTo(-hx, -z0, -hx, -z0 - r);
    roofShape.lineTo(-hx, -z1 + r);
    roofShape.quadraticCurveTo(-hx, -z1, -hx + r, -z1);
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
      depth: 0.02,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.025,
      bevelOffset: -0.025,
      bevelSegments: 3,
      curveSegments: 4,
    }).rotateX(-Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, paint);
    roof.position.y = roofY + 0.015;
    roof.castShadow = true;
    this.root.add(roof);
    // 天井の内張り（車内視点で屋根の裏が暗く見えないように）
    const headliner = new THREE.Mesh(
      new THREE.BoxGeometry(high * 2 - 0.02, 0.02, frontHigh[0] - rearHigh[0]),
      // 下向きの面は地面の照り返し色（緑）を受けるので、照明の影響を受けない素材にする
      new THREE.MeshBasicMaterial({ color: 0x8f8a82 }),
    );
    headliner.position.set(0, roofY - 0.01, (frontHigh[0] + rearHigh[0]) / 2);
    this.root.add(headliner);

    // ピラーと、窓の下の黒い縁
    const pillarZ = -0.35;
    const t = (pillarZ - rearHigh[0]) / (frontHigh[0] - rearHigh[0]);
    for (const s of [-1, 1]) {
      this.root.add(bar(paint, v(s * low, frontLow), v(s * high, frontHigh), 0.05));
      this.root.add(bar(paint, v(s * low, rearLow), v(s * high, rearHigh), 0.07));
      if (t > 0 && t < 1) this.root.add(bar(dark, new THREE.Vector3(s * low, BELT_Y, pillarZ), new THREE.Vector3(s * high, roofY, pillarZ), 0.06));
      this.root.add(bar(dark, new THREE.Vector3(s * (low + 0.005), BELT_Y + 0.012, rearLow[0]), new THREE.Vector3(s * (low + 0.005), BELT_Y + 0.012, frontLow[0]), 0.025));
    }
  }

  private buildInterior(trim: THREE.Material): void {
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x3b3f47 });
    const inner = this.cabinHalf * 2 - 0.04;

    // 車内の床（ボディ上面の色が見えないように覆う）
    const floor = new THREE.Mesh(new THREE.BoxGeometry(inner, 0.02, 2.2), trim);
    floor.position.set(0, BELT_Y + 0.01, -0.45);
    this.root.add(floor);

    // ダッシュボードはフロントガラスの内側に置く
    const dashZ = Math.min(0.78, this.windowProfile[1][0] - 0.17);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(inner, 0.12, 0.3), trim);
    dash.position.set(0, BELT_Y + 0.06, dashZ);
    this.root.add(dash);

    // メーターフード（運転席側）
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.16), trim);
    hood.position.set(CABIN.driverEye.x, BELT_Y + 0.14, dashZ - 0.1);
    this.root.add(hood);

    for (const x of [CABIN.driverEye.x, CABIN.passengerEye.x]) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatMat);
      cushion.position.set(x, SEAT_Y - 0.06, -0.2);
      this.root.add(cushion);
      // 背もたれは屋根を突き抜けない高さにする
      const backH = Math.min(0.6, this.roofY - 0.08 - (BELT_Y + 0.05));
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, backH, 0.1), seatMat);
      back.position.set(x, BELT_Y + 0.05 + backH / 2, -0.5);
      back.rotation.x = -0.15;
      this.root.add(back);
    }
    // 後ろの席は、リアガラスの下に収まる高さにする（収まらない車には置かない）
    const [rearLow, , , rearHigh] = this.windowProfile;
    const rearZ = -1.3;
    const glassY = rearLow[1] + ((rearZ - 0.05 - rearLow[0]) / (rearHigh[0] - rearLow[0])) * (rearHigh[1] - rearLow[1]);
    const rearH = Math.min(0.5, Math.min(glassY, this.roofY) - 0.05 - BELT_Y);
    if (!this.style.twoSeater && rearH > 0.15) {
      const rear = new THREE.Mesh(new THREE.BoxGeometry(inner - 0.2, rearH, 0.1), seatMat);
      rear.position.set(0, BELT_Y + rearH / 2, rearZ);
      this.root.add(rear);
    }

    // ハンドル: 少し上向きに傾けたリング + スポーク
    const column = new THREE.Group();
    column.position.set(CABIN.driverEye.x, BELT_Y + 0.08, 0.5);
    column.rotation.x = -0.45;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 24), trim);
    this.steeringWheel.add(ring);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.02), trim);
    this.steeringWheel.add(spoke);
    const lowerSpoke = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.02), trim);
    lowerSpoke.position.y = -0.08;
    this.steeringWheel.add(lowerSpoke);
    column.add(this.steeringWheel);
    this.root.add(column);
  }

  private buildWheels(): void {
    const { wheelRadius, frontAxle, rearAxle, track } = CAR_DIMENSIONS;
    const tireW = 0.26;
    const rimR = 0.24;
    // タイヤ: 側面の角を丸めた輪（回転体）。車軸を X に向ける
    const round = 0.04;
    const profile: THREE.Vector2[] = [new THREE.Vector2(rimR, tireW / 2 - 0.01)];
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      profile.push(new THREE.Vector2(wheelRadius - round + round * Math.sin(a), tireW / 2 - round + round * Math.cos(a)));
    }
    for (let i = 0; i <= 4; i++) {
      const a = (i / 4) * (Math.PI / 2);
      profile.push(new THREE.Vector2(wheelRadius - round + round * Math.cos(a), -(tireW / 2 - round) - round * Math.sin(a)));
    }
    profile.push(new THREE.Vector2(rimR, -(tireW / 2 - 0.01)));
    const tireGeo = new THREE.LatheGeometry(profile, 32).rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.92, side: THREE.DoubleSide });
    // ホイール: 奥は暗く、外側に 5 本のスポークと縁（回転が見える）
    const barrelGeo = new THREE.CylinderGeometry(rimR, rimR, tireW - 0.04, 24).rotateZ(Math.PI / 2);
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.6, roughness: 0.5 });
    const alloy = new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 0.7, roughness: 0.3, side: THREE.DoubleSide });
    const lipGeo = new THREE.RingGeometry(rimR - 0.03, rimR + 0.004, 28);
    const spokeGeo = new THREE.BoxGeometry(0.03, rimR - 0.01, 0.065).translate(0, (rimR - 0.01) / 2, 0);
    const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16).rotateZ(Math.PI / 2);
    for (const z of [frontAxle, rearAxle]) {
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * track, wheelRadius, z);
        const wheel = new THREE.Mesh(tireGeo, tireMat);
        wheel.castShadow = true;
        wheel.add(new THREE.Mesh(barrelGeo, barrelMat));
        const face = s * (tireW / 2 - 0.03);
        const lip = new THREE.Mesh(lipGeo, alloy);
        lip.rotation.y = Math.PI / 2;
        lip.position.x = face;
        wheel.add(lip);
        for (let k = 0; k < 5; k++) {
          const spoke = new THREE.Mesh(spokeGeo, alloy);
          spoke.position.x = face - s * 0.01;
          spoke.rotation.x = (k / 5) * Math.PI * 2;
          wheel.add(spoke);
        }
        const hub = new THREE.Mesh(hubGeo, alloy);
        hub.position.x = face;
        wheel.add(hub);
        pivot.add(wheel);
        this.root.add(pivot);
        this.wheels.push(wheel);
        if (z === frontAxle) this.frontPivots.push(pivot);
      }
    }
  }

  /** ヘッドライト・テールランプをつける・消す */
  setLights(on: boolean): void {
    if (on === this.lightsOn) return;
    this.lightsOn = on;
    this.headMat?.emissive.setHex(on ? LIGHT_COLORS.headOn : 0x000000);
    this.tailMat?.emissive.setHex(on ? LIGHT_COLORS.tailOn : 0x000000);
    // まだ走らせていない車（メニューの見た目など）は、すぐに開け閉めする
    if (this.lastUpdate === null) this.placePopUps(on ? 1 : 0);
  }

  /** リトラクタブルヘッドライトを、amount（0 = 閉じている、1 = 開いている）だけ起き上がらせる */
  private placePopUps(amount: number): void {
    this.popUp = amount;
    for (const pod of this.popUps) pod.position.y = this.popUpBase + 0.006 + POP_UP_HEIGHT * amount;
  }

  setColor(color: number): void {
    for (const p of this.paints) p.color.setHex(color);
  }

  get color(): number {
    return this.paints[0].color.getHex();
  }

  dispose(): void {
    this.root.removeFromParent();
    const materials = new Set<THREE.Material>();
    this.root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(m);
      }
    });
    for (const m of materials) m.dispose();
  }

  update(s: CarSnapshot): void {
    this.root.position.set(s.x, s.y, s.z);
    // 坂道では車体を傾ける（ヨー → ピッチ → ロールの順）
    this.root.rotation.set(-(s.pitch ?? 0), s.yaw, s.roll ?? 0, 'YXZ');
    for (const p of this.frontPivots) p.rotation.y = s.steerAngle;
    for (const w of this.wheels) w.rotation.x = s.wheelSpin;
    // 運転席から見て、左に切るとハンドルは反時計回り
    this.steeringWheel.rotation.z = -s.steerAngle * STEERING_RATIO;
    if (this.popUps.length) {
      const now = performance.now();
      const dt = this.lastUpdate === null ? 1 : Math.min(0.1, (now - this.lastUpdate) / 1000);
      this.lastUpdate = now;
      const target = this.lightsOn ? 1 : 0;
      const step = dt / POP_UP_SECONDS;
      if (this.popUp !== target) this.placePopUps(this.popUp < target ? Math.min(target, this.popUp + step) : Math.max(target, this.popUp - step));
    }
  }
}
