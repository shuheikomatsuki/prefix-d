import * as THREE from 'three';
import { CAR_DIMENSIONS, type CarSnapshot } from '../sim/car';

/** 車内の座標（車体ローカル、前方 +Z・左 +X）。右ハンドルなので運転席は -X 側 */
export const CABIN = {
  driverEye: new THREE.Vector3(-0.4, 1.26, -0.2),
  // 助手席の視点は背もたれ寄りにして、運転席のキャラクターが視界に入るようにする
  passengerEye: new THREE.Vector3(0.38, 1.24, -0.38),
};

/** ハンドルの回転量 / 前輪の舵角（見た目用の比率） */
const STEERING_RATIO = 6;

/** ボディ上面の高さ */
const BELT_Y = CAR_DIMENSIONS.wheelRadius + 0.475;
/** 座面の高さ */
export const SEAT_Y = BELT_Y + 0.11;

/** 左右のタイヤの間の、つながった車体の半分の幅 [m]（その外側がタイヤハウス） */
const CORE_HALF = 0.55;
/** タイヤハウスの上端の高さと、前後の半分の長さ [m]（ハンドルを切ったタイヤが収まる大きさ） */
const ARCH_TOP = CAR_DIMENSIONS.wheelRadius * 2 + 0.07;
const ARCH_HALF = CAR_DIMENSIONS.wheelRadius + 0.12;

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
}

const DEFAULT_STYLE: CarStyle = { roof: 1.42, window: [-1.5, 0.95, 0.4, -1.15], color: 0xd94141 };

/** 車の id ごとの見た目 */
const CAR_STYLES: Record<string, CarStyle> = {
  standard: DEFAULT_STYLE,
  kei: { roof: 1.56, window: [-1.8, 0.95, 0.6, -1.72], color: 0x8fc7e8 },
  // 全長 3.3m・全幅 1.4m の小さな2人乗り。長いボンネットの後ろに、低く短いハードトップ
  cappuccino: { roof: 1.4, window: [-1.4, 0.72, -0.12, -1.05], color: 0xdc3a5c, scale: 0.76, twoSeater: true, roundHead: true, cabinInset: 0.16 },
  ae85: { roof: 1.4, window: [-1.6, 0.95, 0.35, -1.0], lowerColor: 0x1d1d1f, color: 0xf2f2ee },
  ae86: { roof: 1.4, window: [-1.95, 0.95, 0.35, -1.05], lowerColor: 0x1d1d1f, color: 0xf2f2ee },
  eg6: { roof: 1.38, window: [-2.0, 0.95, 0.35, -1.85], color: 0xc8202a },
  ek9: { roof: 1.4, window: [-2.0, 0.95, 0.35, -1.85], wing: 'low', color: 0xf3d41c },
  s13: { roof: 1.32, window: [-1.6, 1.0, 0.25, -0.85], color: 0x1a9e74 },
  s14: { roof: 1.34, window: [-1.65, 1.0, 0.25, -0.9], wing: 'low', color: 0xe2601f },
  // 白いエボIV（屋根の高いセダンに大きなウイング）と見分けやすいよう、屋根が低く、後ろの窓を寝かせた小さなウイングのクーペ
  fc3s: { roof: 1.3, window: [-1.95, 1.0, 0.22, -0.8], wing: 'low', popUp: true, color: 0xf6f6f2 },
  fd3s: { roof: 1.34, window: [-1.8, 1.05, 0.15, -0.7], wing: 'low', color: 0xf2c318 },
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

/** 2点を結ぶ細い棒（ピラーなど） */
function strut(
  mat: THREE.Material,
  x: number,
  from: [number, number],
  to: [number, number],
  thickness = 0.07,
): THREE.Mesh {
  const dz = to[0] - from[0];
  const dy = to[1] - from[1];
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(thickness, Math.hypot(dz, dy), thickness), mat);
  mesh.position.set(x, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
  mesh.rotation.x = Math.atan2(dz, dy);
  return mesh;
}

/** 箱を組み合わせた簡易な乗用車モデル。前輪の舵角・タイヤの回転・ハンドルの回転を反映する */
/**
 * ランプの色。消えているときはまわりの光で照らされるだけの色（夜は暗く見える）、
 * ついているときは自分で光る色を足す
 */
const LIGHT_COLORS = { headOff: 0x9da19c, headOn: 0xfffbea, tailOff: 0x6e1414, tailOn: 0xff2a1e };

/** リトラクタブルヘッドライトが起き上がる高さ [m] と、起き上がる・閉じるのにかかる時間 [s] */
const POP_UP_HEIGHT = 0.16;
const POP_UP_SECONDS = 0.35;

export class CarMesh {
  private headMat: THREE.MeshLambertMaterial | null = null;
  private tailMat: THREE.MeshLambertMaterial | null = null;
  private lightsOn = false;
  /** リトラクタブルヘッドライト（起き上がる部分）と、どれだけ起き上がっているか（0 = 閉じている、1 = 開いている） */
  private readonly popUps: THREE.Group[] = [];
  private popUp = 0;
  private lastUpdate: number | null = null;
  readonly root = new THREE.Group();
  private readonly frontPivots: THREE.Group[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  private readonly steeringWheel = new THREE.Group();
  private readonly paint: THREE.MeshLambertMaterial;

  private readonly style: CarStyle;
  private readonly roofY: number;
  private readonly windowProfile: [number, number][];

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
    const paint = new THREE.MeshLambertMaterial({ color: color ?? style.color });
    this.paint = paint;
    const dark = new THREE.MeshLambertMaterial({ color: 0x1d1d1f });
    const trim = new THREE.MeshLambertMaterial({ color: 0x2b2d31 });
    this.buildBody(paint, dark);
    this.buildCabin(paint, trim);
    this.buildInterior(trim);
    this.buildWheels(dark);
    this.root.scale.setScalar(style.scale ?? 1);
  }

  private buildBody(paint: THREE.Material, dark: THREE.Material): void {
    const { width, length, wheelRadius } = CAR_DIMENSIONS;
    this.addShell(wheelRadius - 0.075, wheelRadius + 0.475, 0, paint, true);
    // タイヤハウスの奥（暗くして、タイヤがはっきり見えるように）
    for (const z of [CAR_DIMENSIONS.frontAxle, CAR_DIMENSIONS.rearAxle]) {
      for (const s of [-1, 1]) {
        const well = new THREE.Mesh(new THREE.BoxGeometry(0.02, ARCH_TOP - (wheelRadius - 0.075), ARCH_HALF * 2), dark);
        well.position.set(s * (CORE_HALF + 0.011), (ARCH_TOP + wheelRadius - 0.075) / 2, z);
        this.root.add(well);
      }
    }

    for (const z of [length / 2, -length / 2]) {
      const bumper = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.2, 0.16), dark);
      bumper.position.set(0, wheelRadius + 0.02, z);
      this.root.add(bumper);
    }

    const { lowerColor, roundTail, wing } = this.style;
    if (lowerColor !== undefined) {
      // ツートン: ボディの下半分を別の色にする
      this.addShell(wheelRadius - 0.07, wheelRadius + 0.19, 0.01, new THREE.MeshLambertMaterial({ color: lowerColor }), false);
    }

    const lightGeo = new THREE.BoxGeometry(0.4, 0.14, 0.05);
    const [innerR, outerR] = this.style.tailRadii ?? [0.1, 0.1];
    const roundGeo = (r: number) => new THREE.CylinderGeometry(r, r, 0.05, 16).rotateX(Math.PI / 2);
    const tailGeos = [roundGeo(innerR), roundGeo(outerR)];
    const headMat = new THREE.MeshLambertMaterial({ color: LIGHT_COLORS.headOff });
    const tailMat = new THREE.MeshLambertMaterial({ color: LIGHT_COLORS.tailOff });
    this.headMat = headMat;
    this.tailMat = tailMat;
    for (const s of [-1, 1]) {
      if (this.style.popUp) {
        // 閉じているときは上面だけがボンネットと同じ高さに見え、ライトをつけると起き上がって前にランプが見える
        const pod = new THREE.Group();
        const lid = new THREE.Mesh(new THREE.BoxGeometry(0.44, POP_UP_HEIGHT + 0.01, 0.3), paint);
        lid.position.y = -(POP_UP_HEIGHT + 0.01) / 2;
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.02), headMat);
        lamp.position.set(0, -0.075, 0.151);
        pod.add(lid, lamp);
        pod.position.set(s * (width / 2 - 0.34), BELT_Y + 0.006, length / 2 - 0.3);
        this.root.add(pod);
        this.popUps.push(pod);
      } else {
        const head = new THREE.Mesh(this.style.roundHead ? roundGeo(0.13) : lightGeo, headMat);
        head.position.set(s * (width / 2 - 0.3), wheelRadius + 0.3, length / 2 + 0.01);
        this.root.add(head);
      }
      if (roundTail) {
        // 丸いテールランプを左右に2つずつ
        // 外側の中心は、ランプの縁が車体の端から少し内側に来る位置
        const outerDx = Math.max(0.22, outerR + 0.1);
        [outerDx + outerR + innerR + 0.06, outerDx].forEach((dx, i) => {
          const tail = new THREE.Mesh(tailGeos[i], tailMat);
          tail.position.set(s * (width / 2 - dx), wheelRadius + 0.3, -length / 2 - 0.01);
          this.root.add(tail);
        });
      } else {
        const tail = new THREE.Mesh(lightGeo, tailMat);
        tail.position.set(s * (width / 2 - 0.3), wheelRadius + 0.3, -length / 2 - 0.01);
        this.root.add(tail);
      }

      // ドアミラー
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.08), paint);
      mirror.position.set(s * (width / 2 + 0.08), BELT_Y + 0.12, 0.75);
      this.root.add(mirror);
    }

    if (wing) {
      // リアウイング: 2本の支柱の上に板
      const h = wing === 'high' ? 0.32 : 0.14;
      const z = -length / 2 + 0.22;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(width - 0.1, 0.04, 0.3), paint);
      blade.position.set(0, BELT_Y + h, z);
      blade.castShadow = true;
      this.root.add(blade);
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.12), dark);
        post.position.set(s * (width / 2 - 0.35), BELT_Y + h / 2, z);
        this.root.add(post);
      }
    }
  }

  /**
   * ボディの下半分（高さ y0〜y1 の箱）。タイヤの上はえぐって（タイヤハウス）、ハンドルを切った前輪も車体に埋まらないようにする。
   * inflate: 外側にふくらませる量（ツートンの帯を本体の上に重ねるとき）
   */
  private addShell(y0: number, y1: number, inflate: number, mat: THREE.Material, shadow: boolean): void {
    const { width, length, frontAxle, rearAxle } = CAR_DIMENSIONS;
    const half = width / 2 + inflate;
    const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      if (w <= 0 || h <= 0 || d <= 0) return;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      this.root.add(m);
    };
    // 真ん中（左右のタイヤの間）は前から後ろまでつながった箱
    add(CORE_HALF * 2, y1 - y0, length + inflate * 2, 0, (y0 + y1) / 2, 0);
    // 左右の外側: タイヤハウスより上はつながり、下はタイヤの前後で切れる
    const side = half - CORE_HALF;
    const cx = (half + CORE_HALF) / 2;
    const top = Math.max(y0, Math.min(y1, ARCH_TOP));
    const front = length / 2 + inflate;
    const cuts: [number, number][] = [
      [-front, rearAxle - ARCH_HALF],
      [rearAxle + ARCH_HALF, frontAxle - ARCH_HALF],
      [frontAxle + ARCH_HALF, front],
    ];
    for (const s of [-1, 1]) {
      add(side, y1 - top, length + inflate * 2, s * cx, (top + y1) / 2, 0);
      for (const [z0, z1] of cuts) add(side, top - y0, z1 - z0, s * cx, (y0 + top) / 2, (z0 + z1) / 2);
    }
  }

  private buildCabin(paint: THREE.Material, trim: THREE.Material): void {
    const { width } = CAR_DIMENSIONS;
    const glass = new THREE.MeshPhongMaterial({
      color: 0x9cc3db,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
      shininess: 80,
    });
    const [rearLow, frontLow, frontHigh, rearHigh] = this.windowProfile;
    const roofY = this.roofY;
    const halfW = width / 2 - 0.06 - (this.style.cabinInset ?? 0);

    // 側面の窓（台形）
    const shape = new THREE.Shape(this.windowProfile.map(([z, y]) => new THREE.Vector2(z, y)));
    const sideGeo = new THREE.ShapeGeometry(shape).rotateY(-Math.PI / 2);
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(sideGeo, glass);
      side.position.x = s * halfW;
      this.root.add(side);
    }

    // フロントガラス・リアガラス（傾いた板）
    const slanted = (from: [number, number], to: [number, number]) => {
      const dz = to[0] - from[0];
      const dy = to[1] - from[1];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, Math.hypot(dz, dy)), glass);
      mesh.position.set(0, (from[1] + to[1]) / 2, (from[0] + to[0]) / 2);
      mesh.rotation.x = Math.atan2(dz, dy);
      this.root.add(mesh);
    };
    slanted(frontLow, frontHigh);
    slanted(rearLow, rearHigh);

    // 屋根とピラー
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2 + 0.04, 0.06, frontHigh[0] - rearHigh[0] + 0.1),
      paint,
    );
    roof.position.set(0, roofY + 0.03, (frontHigh[0] + rearHigh[0]) / 2);
    roof.castShadow = true;
    this.root.add(roof);
    // 天井の内張り（車内視点で屋根の裏が暗く見えないように）
    const headliner = new THREE.Mesh(
      new THREE.BoxGeometry(halfW * 2 - 0.02, 0.02, frontHigh[0] - rearHigh[0]),
      // 下向きの面は地面の照り返し色（緑）を受けるので、照明の影響を受けない素材にする
      new THREE.MeshBasicMaterial({ color: 0x8f8a82 }),
    );
    headliner.position.set(0, roofY - 0.01, (frontHigh[0] + rearHigh[0]) / 2);
    this.root.add(headliner);
    for (const s of [-1, 1]) {
      const x = s * halfW;
      this.root.add(strut(paint, x, frontLow, frontHigh, 0.05));
      this.root.add(strut(paint, x, rearLow, rearHigh));
      this.root.add(strut(trim, x, [-0.35, BELT_Y], [-0.35, roofY], 0.06));
    }
  }

  private buildInterior(trim: THREE.Material): void {
    const { width } = CAR_DIMENSIONS;
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x3b3f47 });

    // 車内の床（ボディ上面の赤が見えないように覆う）
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width - 0.14, 0.02, 2.2), trim);
    floor.position.set(0, BELT_Y + 0.01, -0.45);
    this.root.add(floor);

    // ダッシュボードはフロントガラスの内側に置く
    const dashZ = Math.min(0.78, this.windowProfile[1][0] - 0.17);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(width - 0.16 - 2 * (this.style.cabinInset ?? 0), 0.12, 0.3), trim);
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
      const rear = new THREE.Mesh(new THREE.BoxGeometry(width - 0.3, rearH, 0.1), seatMat);
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

  private buildWheels(dark: THREE.Material): void {
    const { wheelRadius, frontAxle, rearAxle, track } = CAR_DIMENSIONS;
    // タイヤ: 回転が見えるようにホイールキャップを中心からずらして付ける
    const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.28, 16).rotateZ(Math.PI / 2);
    const capGeo = new THREE.BoxGeometry(0.3, wheelRadius * 0.9, 0.12);
    const capMat = new THREE.MeshLambertMaterial({ color: 0xb0b4ba });
    for (const z of [frontAxle, rearAxle]) {
      for (const s of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(s * track, wheelRadius, z);
        const wheel = new THREE.Mesh(tireGeo, dark);
        wheel.castShadow = true;
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.x = s * 0.05;
        wheel.add(cap);
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
    for (const pod of this.popUps) pod.position.y = BELT_Y + 0.006 + POP_UP_HEIGHT * amount;
  }

  setColor(color: number): void {
    this.paint.color.setHex(color);
  }

  get color(): number {
    return this.paint.color.getHex();
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
