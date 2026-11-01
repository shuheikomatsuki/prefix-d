import { ROAD_ORIGIN, type RoadPiece, type RoadSpec, closeLoop, reverseRoad } from './road';
import type { MapDefinition } from './tilemap';

/** 最初の練習用の小さな街 */
export const TOWN_MAP: MapDefinition = {
  id: 'town',
  name: '小さな街',
  tileSize: 20,
  roadWidth: 12,
  layout: [
    '...........',
    '.RRRRRRRRR.',
    '.R.B.R.B.R.',
    '.R.B.R.T.R.',
    '.RRRRRRcRR.',
    '.R.T.R.T.R.',
    '.R.B.R.BBR.',
    '.RRRRR...R.',
    '.T.B.RRRRR.',
    '...........',
  ],
  start: { col: 2, row: 4, heading: 'E' },
  signs: [
    { col: 3, row: 4, type: 'speed40', corner: 'NW', facing: 'W' },
    { col: 5, row: 3, type: 'stop', corner: 'SE', facing: 'N' },
    { col: 5, row: 5, type: 'stop', corner: 'NW', facing: 'S' },
  ],
};

/** 教習所のような練習コース。外周、S字・クランク風の連続カーブ、内側の交差点 */
export const SCHOOL_MAP: MapDefinition = {
  id: 'school',
  name: '教習所コース',
  tileSize: 20,
  roadWidth: 12,
  layout: [
    '.............',
    '.RRRRRRcRRRR.',
    '.R....B....R.',
    '.R.RRR.RRR.R.',
    '.R.R.R.R.R.R.',
    '.RRR.RRR.RRR.',
    '.R.........R.',
    '.R..RRRRR..R.',
    '.RRRR.R.RRRR.',
    '.T..RRRRR..T.',
    '.............',
  ],
  start: { col: 2, row: 1, heading: 'E' },
  guardrails: true,
  signs: [
    { col: 3, row: 1, type: 'speed30', corner: 'NW', facing: 'W' },
    { col: 11, row: 4, type: 'stop', corner: 'SE', facing: 'N' },
    { col: 3, row: 8, type: 'stop', corner: 'NE', facing: 'W' },
    { col: 9, row: 8, type: 'stop', corner: 'SW', facing: 'E' },
  ],
};






/** 中心線で描く道路のマップ（タイルのレイアウトは使わない） */
function roadMap(id: string, name: string, road: RoadSpec, laps = 1): MapDefinition {
  return { id, name, tileSize: 20, roadWidth: road.width, layout: [], start: { col: 0, row: 0, heading: 'E' }, race: { laps }, road };
}

/** ごく僅かに左右へくねりながら続く直線（半径 radius [m] の円弧で ±turn [度] ずつ、count 回） */
function wiggle(count: number, radius: number, turn: number, extra: Omit<RoadPiece, 'straight' | 'arc'> = {}): RoadPiece[] {
  // 最初と最後は半分だけ曲げて、入る向きと出る向きを直線と同じにする
  return Array.from({ length: count }, (_, i) => {
    const t = i === 0 || i === count - 1 ? turn / 2 : turn;
    return { arc: { radius, turn: i % 2 === 0 ? t : -t }, ...extra };
  });
}

/**
 * 峠（約 2km・高低差 150m）。ふもとから頂上まで、半径の大きな高速コーナー、S 字、低速のヘアピンが
 * 混じる。下りは同じ道を頂上から
 */
const PASS_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 150 },
    { arc: { radius: 120, turn: 35 } },
    { straight: 100 },
    { arc: { radius: 40, turn: -80 } },
    { straight: 60 },
    // ヘアピン
    { arc: { radius: 18, turn: 170 }, h: 30 },
    { straight: 120 },
    { arc: { radius: 80, turn: -60 } },
    { arc: { radius: 80, turn: 45 } },
    { straight: 90 },
    { arc: { radius: 22, turn: -165 } },
    { straight: 80, h: 70 },
    // 高速コーナー
    { arc: { radius: 150, turn: 40 } },
    { straight: 150 },
    { arc: { radius: 35, turn: 95 } },
    { arc: { radius: 45, turn: -110 } },
    { straight: 70 },
    { arc: { radius: 20, turn: 175 }, h: 110 },
    { straight: 100 },
    { arc: { radius: 100, turn: -50 } },
    { arc: { radius: 60, turn: 70 } },
    { straight: 170, h: 150 },
  ],
};

export const HILLCLIMB_MAP = roadMap('pass-up', '峠（ヒルクライム）', PASS_ROAD);
export const DOWNHILL_MAP = roadMap('pass-down', '峠（ダウンヒル）', reverseRoad(PASS_ROAD, 60));

/** 上って峠を越え、反対側へ下る（約 2.1km）。頂上の前後で上りと下りが入れ替わる */
export const PASS_OVER_MAP = roadMap('pass-over-r', '峠（山越え）', {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 120 },
    { arc: { radius: 60, turn: 70 } },
    { straight: 80 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 100 },
    { arc: { radius: 90, turn: 60 } },
    { arc: { radius: 30, turn: -90 }, h: 60 },
    { straight: 140 },
    { arc: { radius: 20, turn: 170 } },
    { straight: 90, h: 95 },
    // 頂上: 見通しのよい高速の左右
    { arc: { radius: 160, turn: -35 }, h: 105 },
    { arc: { radius: 160, turn: 35 } },
    { straight: 100, h: 100 },
    // 下り
    { arc: { radius: 35, turn: 120 } },
    { straight: 120 },
    { arc: { radius: 22, turn: -160 } },
    { straight: 80, h: 60 },
    { arc: { radius: 70, turn: 80 } },
    { arc: { radius: 45, turn: -100 } },
    { straight: 150 },
    { arc: { radius: 120, turn: 50 } },
    { straight: 160, h: 15 },
  ],
});

/** 上りと下りを何度もくり返す、全長 2.9km ほどの長い峠 */
export const LONG_MAP = roadMap('long-r', '峠（ロング）', {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 140 },
    { arc: { radius: 100, turn: -45 } },
    { straight: 90 },
    { arc: { radius: 30, turn: 120 } },
    { straight: 70 },
    { arc: { radius: 45, turn: -90 }, h: 40 },
    { straight: 160 },
    { arc: { radius: 200, turn: 40 } },
    { straight: 120, h: 55 },
    { arc: { radius: 20, turn: 170 } },
    { straight: 110 },
    { arc: { radius: 50, turn: -70 }, h: 25 },
    { straight: 140 },
    { arc: { radius: 35, turn: -110 } },
    { straight: 80 },
    { arc: { radius: 70, turn: 90 }, h: 70 },
    { straight: 120 },
    { arc: { radius: 25, turn: -165 } },
    { straight: 100, h: 95 },
    { arc: { radius: 130, turn: 50 } },
    { straight: 200, h: 70 },
    { arc: { radius: 40, turn: 100 } },
    { arc: { radius: 40, turn: -100 } },
    { straight: 130 },
    { arc: { radius: 22, turn: 170 }, h: 110 },
    { straight: 120 },
    { arc: { radius: 90, turn: -60 } },
    { straight: 150, h: 125 },
  ],
});

/**
 * 峠の途中に、まっすぐな 800m のロングストレートと、ごく僅かに左右へくねる 650m のロングストレートがある
 * （約 2.9km・高低差 170m）。ストレートの前後と間は、ふつうの峠のコーナーが続く
 */
const STRAIGHT_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 9,
  start: 60,
  pieces: [
    { straight: 100 },
    { arc: { radius: 35, turn: 90 } },
    { straight: 60 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 80 },
    { arc: { radius: 60, turn: 60 }, h: 25 },
    // まっすぐなロングストレート
    { straight: 800, h: 75 },
    // 間の峠のコーナー
    { arc: { radius: 30, turn: 120 } },
    { straight: 70 },
    { arc: { radius: 20, turn: -170 } },
    { straight: 90 },
    { arc: { radius: 80, turn: 70 } },
    { arc: { radius: 40, turn: -100 }, h: 100 },
    { straight: 60 },
    // ごく僅かに左右へくねるロングストレート
    ...wiggle(12, 450, 7),
    { straight: 60, h: 140 },
    // ふつうの峠のコーナー
    { arc: { radius: 35, turn: 110 } },
    { straight: 80 },
    { arc: { radius: 22, turn: -160 } },
    { straight: 90 },
    { arc: { radius: 100, turn: 45 } },
    { straight: 150, h: 170 },
  ],
};

export const STRAIGHT_UP_MAP = roadMap('straight-up-r', 'ロングストレート（ヒルクライム）', STRAIGHT_ROAD);
export const STRAIGHT_DOWN_MAP = roadMap('straight-down-r', 'ロングストレート（ダウンヒル）', reverseRoad(STRAIGHT_ROAD, 60));

/**
 * 道路の左（side = 1）か右（side = -1）に offset [m] 離れて並ぶ道を、逆向きに走る区間（U ターンの帰り道）。
 * 内側になるカーブは半径が offset だけ小さく、外側になるカーブは大きくなる。高さは行きと同じ所で同じ
 */
function alongside(pieces: readonly RoadPiece[], offset: number, side: 1 | -1): RoadPiece[] {
  return pieces.map((_, j) => {
    const i = pieces.length - 1 - j;
    const p = pieces[i];
    const piece: RoadPiece = p.arc
      ? { arc: { radius: p.arc.radius - Math.sign(p.arc.turn) * side * offset, turn: -p.arc.turn } }
      : { straight: p.straight };
    // 逆向きの区間の終わり = 行きの区間の始まり
    const h = i === 0 ? 0 : pieces[i - 1].h;
    if (h !== undefined) piece.h = h;
    return piece;
  });
}

/** U ターンの峠の行き（谷沿いに上る） */
const UTURN_OUT: RoadPiece[] = [
  { straight: 120, h: 0 },
  { arc: { radius: 80, turn: 50 } },
  { straight: 60 },
  { arc: { radius: 35, turn: -110 } },
  { straight: 70 },
  { arc: { radius: 65, turn: 90 }, h: 40 },
  { straight: 80 },
  { arc: { radius: 30, turn: -120 } },
  { straight: 60 },
  { arc: { radius: 90, turn: 70 }, h: 65 },
  { straight: 100 },
  { arc: { radius: 40, turn: -80 } },
  { straight: 60, h: 85 },
];

/**
 * 谷沿いに上り、頂上のヘアピンで折り返して、すぐ隣（38m 横）を並んで下る（約 2.1km）。ゴールはスタートのすぐそば。
 * 行きの高速コーナーは帰りの低速コーナーに、行きの低速コーナーは帰りの高速コーナーになる
 */
export const UTURN_MAP = roadMap('uturn', '峠（Uターン）', {
  scenery: 'touge',
  width: 11,
  start: 60,
  pieces: [...UTURN_OUT, { arc: { radius: 19, turn: 180 }, h: 85 }, ...alongside(UTURN_OUT, 38, 1)],
});

/** ヘアピンのすぐ前後に残す直線の長さ [m]（ヘアピンの内側の近道の帯が、この直線にはさまれる） */
const HAIRPIN_STRAIGHT = 14;
/** ヘアピンの間のうねりの、1 往復（左右 1 組）のおおよその長さ [m] */
const WAVE_LENGTH = 50;
/** うねりの円弧が向きを変える角度の上限 [度] */
const MAX_WAVE_ANGLE = 40;

/**
 * ヘアピンが左右交互に続くつづら折り（スネークヘアピン）。legs は [ヘアピンの手前の区間の長さ, ヘアピンの半径,
 * うねりのカーブの半径] の並び。最初のヘアピンが first の向き（1 = 左、-1 = 右）に回る。
 *
 * ヘアピンの間は、ヘアピンの前後の短い直線（HAIRPIN_STRAIGHT）を残して、左右にうねり続ける
 * （+角度・-2×角度・+2×角度 … -2×角度・+角度 の円弧で、向きは元に戻る）。うねりの数は区間の長さで決まり
 * （WAVE_LENGTH ごとに 1 往復）、角度はうねりのカーブがその半径になるように決める。半径の符号は最初に曲がる向き。
 * 隣り合う区間がぶつからないよう、うねりの向きは地図の上でそろえる（行きと帰りで曲がる向きが逆になる）。
 *
 * ヘアピンの間は見通しの悪い区間（blind）で、木が道路のすぐ脇まで茂り、山側は道路のすぐ脇から岩の崖が立つ。
 * 山側は、下りなら一つ前の区間（上を通る）の側、上りなら一つ後の区間の側（descending）
 */
function switchbacks(legs: readonly (readonly [number, number, number])[], first: 1 | -1, descending: boolean): RoadPiece[] {
  return legs.flatMap(([leg, radius, bend], i): RoadPiece[] => {
    const dir: 1 | -1 = i % 2 === 0 ? first : first === 1 ? -1 : 1;
    const hairpin: RoadPiece = { arc: { radius, turn: 180 * dir } };
    // 次の区間はヘアピンの曲がる側にある
    const cut: 1 | -1 = descending === (dir === 1) ? -1 : 1;
    const rest = leg - 2 * HAIRPIN_STRAIGHT;
    const waves = Math.max(1, Math.round(rest / WAVE_LENGTH));
    const angle = Math.min(MAX_WAVE_ANGLE, (rest / (4 * waves * Math.abs(bend)) / Math.PI) * 180);
    const r = rest / (4 * waves * ((angle * Math.PI) / 180));
    const turn = Math.sign(bend) * angle * (i % 2 === 0 ? 1 : -1);
    const blind = { blind: true, cut } as const;
    const bends: RoadPiece[] = [{ arc: { radius: r, turn }, ...blind }];
    for (let w = 1; w < 2 * waves; w++) bends.push({ arc: { radius: r, turn: (w % 2 === 1 ? -2 : 2) * turn }, ...blind });
    bends.push({ arc: { radius: r, turn }, ...blind });
    return [{ straight: HAIRPIN_STRAIGHT, ...blind }, ...bends, { straight: HAIRPIN_STRAIGHT, ...blind }, hairpin];
  });
}

/**
 * 第一いろは坂（下り専用・約 6.5km・高低差 440m・28 カーブ）。中禅寺湖のそばの頂上から馬返へ下る。
 * 実際の道の形のデータは使っておらず、カーブの数・長さ・高低差と、区間の並びを実際に合わせている:
 *
 * - 頂上の剣ヶ峰付近: 中速の左右が続く
 * - 急な斜面を、ヘアピンが積み重なるように下る上側のつづら折り（ヘアピン 9 個）
 * - 斜面をトラバースする中速区間の先で、下側のつづら折り（ヘアピン 8 個）
 * - 馬返の手前: 間隔の開いたコーナーと直線。最後に谷を橋で渡る
 *
 * 2 車線の一方通行で道幅は広い。ヘアピンの内側には段差のある近道の帯があり、
 * 内側の内側を攻める「地元走り」ができる（src/map/roadShortcuts.ts）
 */
const IROHA_DOWN_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 10,
  start: 60,
  startHeight: 440,
  pieces: [
    // 頂上の剣ヶ峰付近
    { straight: 280, h: 436 },
    { arc: { radius: 160, turn: -30 } },
    { straight: 220 },
    { arc: { radius: 45, turn: 80 } },
    { straight: 150 },
    { arc: { radius: 35, turn: -95 } },
    { straight: 160 },
    { arc: { radius: 50, turn: 90 } },
    { straight: 120 },
    { arc: { radius: 60, turn: -45 } },
    { straight: 110, h: 395 },
    // 上側のつづら折り
    ...switchbacks(
      [
        [140, 16, 30],
        [125, 15, 34],
        [135, 17, 28],
        [115, 15, 32],
        [130, 16, 29],
        [110, 15, 33],
        [125, 17, 27],
        [105, 15, 31],
        [120, 16, 30],
      ],
      -1,
      true,
    ),
    { straight: 150, h: 255 },
    // 斜面をトラバースする中速区間
    { arc: { radius: 70, turn: 90 } },
    { straight: 220 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 120, h: 215 },
    // 下側のつづら折り
    ...switchbacks(
      [
        [130, 15, -30],
        [120, 16, -33],
        [130, 15, -28],
        [110, 17, -32],
        [125, 15, -29],
        [105, 16, -34],
        [120, 15, -30],
        [110, 18, -31],
      ],
      -1,
      true,
    ),
    { straight: 150, h: 95 },
    // 馬返の手前
    { arc: { radius: 70, turn: -70 } },
    { straight: 200 },
    { arc: { radius: 55, turn: 80 } },
    { straight: 180 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 220 },
    { arc: { radius: 45, turn: 90 } },
    { straight: 160 },
    { arc: { radius: 35, turn: 60 } },
    // 馬返の手前で谷を渡る橋
    { straight: 25 },
    { straight: 110, bridge: true, valley: 22 },
    { straight: 25 },
    { arc: { radius: 120, turn: -20 } },
    { straight: 200, h: 0 },
  ],
};

/**
 * 第二いろは坂（上り専用・約 9.4km・高低差 440m・20 カーブ）。馬返から明智平を通って中禅寺湖のそばの頂上へ上る。
 * 第一いろは坂と同じく、カーブの数・長さ・高低差と区間の並びを実際に合わせている:
 *
 * - 馬返から: 谷沿いの緩い勾配。高速の緩いカーブと長い直線の間に、中速のコーナーがはさまる
 * - 斜面に取り付いて、間隔の広いヘアピンを積み重ねて上る（ヘアピン 12 個）
 * - 明智平の手前の中速区間。明智平を過ぎるとトンネルを抜け、緩い上りで頂上へ
 */
const IROHA_UP_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 10,
  start: 60,
  pieces: [
    // 馬返から谷沿いの緩い上り
    { straight: 300, h: 0 },
    { arc: { radius: 300, turn: 20 } },
    { straight: 450 },
    { arc: { radius: 50, turn: -85 } },
    { straight: 480 },
    { arc: { radius: 400, turn: 18 } },
    { straight: 400, h: 50 },
    { arc: { radius: 60, turn: 90 } },
    { straight: 350 },
    { arc: { radius: 250, turn: -30 } },
    { straight: 380 },
    { arc: { radius: 45, turn: -100 } },
    { straight: 360 },
    { arc: { radius: 350, turn: 25 }, h: 120 },
    { straight: 180 },
    { arc: { radius: 55, turn: 85 } },
    { straight: 150, h: 135 },
    // 斜面のつづら折り
    ...switchbacks(
      [
        [240, 20, 34],
        [225, 19, 38],
        [250, 21, 32],
        [220, 19, 36],
        [235, 20, 33],
        [215, 19, 37],
        [240, 21, 31],
        [210, 19, 35],
        [230, 20, 34],
        [220, 19, 38],
        [225, 21, 32],
        [210, 20, 36],
      ],
      1,
      false,
    ),
    { straight: 160, h: 360 },
    // 明智平の手前の中速区間
    { arc: { radius: 50, turn: 90 } },
    { straight: 200 },
    { arc: { radius: 65, turn: -70 } },
    { straight: 140 },
    { arc: { radius: 40, turn: -110 } },
    { straight: 200, h: 390 },
    // 明智平を過ぎてトンネルへ
    { arc: { radius: 200, turn: 30 } },
    { straight: 120 },
    { arc: { radius: 180, turn: -45 }, tunnel: true },
    { straight: 300, tunnel: true, h: 420 },
    { straight: 120 },
    { arc: { radius: 250, turn: 25 } },
    { straight: 250, h: 440 },
  ],
};

export const IROHA_UP_MAP = roadMap('iroha-up', 'いろは坂（ヒルクライム）', IROHA_UP_ROAD);

/** 第一いろは坂を下る。ヘアピンの内側の近道を使える */
export const IROHA_DOWN_MAP: MapDefinition = { ...roadMap('iroha-down', 'いろは坂（ダウンヒル）', IROHA_DOWN_ROAD), shortcuts: true };

/** 急な坂の峠（約 1.4km・高低差 230m）。きついヘアピンが 3 つある */
const STEEP_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 11,
  start: 50,
  pieces: [
    { straight: 70, h: 0 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 70 },
    { arc: { radius: 18, turn: -170 } },
    { straight: 90 },
    { arc: { radius: 60, turn: 70 } },
    { arc: { radius: 35, turn: -80 } },
    { straight: 100 },
    { arc: { radius: 16, turn: 175 } },
    { straight: 80 },
    { arc: { radius: 50, turn: -60 } },
    { straight: 60 },
    { arc: { radius: 25, turn: -120 } },
    { straight: 90 },
    { arc: { radius: 80, turn: 50 } },
    { straight: 70 },
    { arc: { radius: 20, turn: 170 } },
    { straight: 100 },
    { arc: { radius: 45, turn: -90 } },
    { straight: 80, h: 230 },
  ],
};

/** 急な坂を上る。パワーのない車は坂の途中で伸びなくなる */
export const STEEP_UP_MAP = roadMap('steep-up', '激坂（ヒルクライム）', STEEP_ROAD);
/** 同じ激坂を下る。ブレーキを早めに踏まないとコーナーで止まりきれない */
export const STEEP_DOWN_MAP = roadMap('steep-down', '激坂（ダウンヒル）', reverseRoad(STEEP_ROAD, 50));

/** 上りと下りを何度もくり返す、全長 6km を超える峠 */
export const MARATHON_MAP = roadMap('marathon', '峠（超ロング）', {
  scenery: 'touge',
  width: 11,
  start: 60,
  pieces: [
    { straight: 150, h: 0 },
    { arc: { radius: 60, turn: 70 } },
    { straight: 90 },
    { arc: { radius: 30, turn: -120 } },
    { straight: 80 },
    { arc: { radius: 90, turn: 60 } },
    { straight: 120, h: 60 },
    { arc: { radius: 22, turn: -170 } },
    { straight: 100 },
    { arc: { radius: 45, turn: 110 } },
    { straight: 70 },
    { arc: { radius: 120, turn: 40 }, h: 30 },
    { straight: 150 },
    { arc: { radius: 35, turn: -90 } },
    { straight: 80 },
    { arc: { radius: 70, turn: 80 } },
    { straight: 60 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 110, h: 90 },
    { arc: { radius: 55, turn: 100 } },
    { straight: 90 },
    { arc: { radius: 160, turn: -30 } },
    { straight: 200, h: 85 },
    { arc: { radius: 28, turn: 140 } },
    { straight: 80 },
    { arc: { radius: 40, turn: -110 } },
    { straight: 70 },
    { arc: { radius: 80, turn: 60 } },
    { straight: 130, h: 140 },
    { arc: { radius: 20, turn: -170 } },
    { straight: 90 },
    { arc: { radius: 50, turn: 90 } },
    { straight: 100, h: 115 },
    { arc: { radius: 35, turn: -100 } },
    { straight: 80 },
    { arc: { radius: 100, turn: 60 } },
    { straight: 140 },
    { arc: { radius: 24, turn: 160 }, h: 170 },
    { straight: 100 },
    { arc: { radius: 60, turn: -80 } },
    { straight: 70 },
    { arc: { radius: 30, turn: 120 }, h: 200 },
    { straight: 120 },
    { arc: { radius: 45, turn: -90 } },
    { straight: 90, h: 175 },
    { arc: { radius: 130, turn: 50 } },
    { straight: 110 },
    { arc: { radius: 26, turn: -150 } },
    { straight: 90, h: 140 },
    { arc: { radius: 70, turn: 90 } },
    { straight: 80 },
    { arc: { radius: 38, turn: -100 } },
    { straight: 120, h: 100 },
    { arc: { radius: 90, turn: -60 } },
    { straight: 100 },
    { arc: { radius: 22, turn: 165 } },
    { straight: 150, h: 60 },
    { arc: { radius: 50, turn: -90 } },
    { straight: 100 },
    { arc: { radius: 30, turn: 130 } },
    { straight: 90 },
    { arc: { radius: 80, turn: -60 }, h: 80 },
    { straight: 120 },
    { arc: { radius: 24, turn: -160 } },
    { straight: 110 },
    { arc: { radius: 60, turn: 90 } },
    { straight: 130, h: 30 },
  ],
});

/**
 * 首都高・都心環状線のような、高架の周回コース（オリジナル・約 5km・2 車線）。実際の道の形のデータは使っておらず、
 * 都心環状線の名所の並び（内回り）をなぞって作った:
 *
 * - 京橋から日本橋川の上へ。江戸橋 JCT のきつい左
 * - 神田橋〜竹橋: 半径 50m ほどの S 字が続く
 * - 北の丸の下の千代田トンネル
 * - 三宅坂〜霞が関の中速コーナー、谷町 JCT のきつい左
 * - 一ノ橋〜芝公園の中速区間、浜崎橋 JCT のきつい左から汐留を抜けて京橋へ戻る
 *
 * 長い直線はなく、道幅の狭い 2 車線で、両側は壁
 */
const C1_PIECES: RoadPiece[] = [
  // 京橋〜江戸橋 JCT（日本橋川の上）
  { straight: 120, h: 0 },
  { arc: { radius: 90, turn: 30 } },
  { straight: 120 },
  { arc: { radius: 45, turn: 80 }, h: 4 },
  { straight: 180 },
  { arc: { radius: 70, turn: -40 } },
  { straight: 120, h: 6 },
  // 神田橋〜竹橋の S 字
  { arc: { radius: 50, turn: -60 } },
  { straight: 70 },
  { arc: { radius: 45, turn: 95 } },
  { straight: 60 },
  { arc: { radius: 55, turn: -50 }, h: 2 },
  { straight: 100 },
  { arc: { radius: 80, turn: 55 }, h: -4 },
  // 北の丸の下の千代田トンネル
  { arc: { radius: 150, turn: 30 }, tunnel: true, h: -8 },
  { straight: 280, tunnel: true },
  { arc: { radius: 160, turn: -20 }, tunnel: true, h: -6 },
  { straight: 80, h: 0 },
  { arc: { radius: 70, turn: 25 } },
  // 三宅坂〜霞が関、谷町 JCT
  { straight: 150 },
  { arc: { radius: 55, turn: 60 } },
  { straight: 200, h: 4 },
  { arc: { radius: 80, turn: -40 } },
  { straight: 120, h: 6 },
  { arc: { radius: 38, turn: 105 }, h: 8 },
  { straight: 120 },
  { arc: { radius: 60, turn: -50 } },
  // 一ノ橋〜芝公園
  { straight: 330, h: 4 },
  { arc: { radius: 70, turn: 50 } },
  { straight: 160 },
  { arc: { radius: 65, turn: -40 }, h: 2 },
  { straight: 220 },
  { arc: { radius: 90, turn: 40 } },
  { straight: 100 },
  // 浜崎橋 JCT のきつい左、汐留の S 字
  { arc: { radius: 42, turn: 90 }, h: 0 },
  { straight: 120 },
  { arc: { radius: 70, turn: -35 } },
  { straight: 80 },
  { arc: { radius: 60, turn: 50 } },
  { straight: 90 },
  { arc: { radius: 80, turn: -40 } },
  { straight: 60 },
];

export const SHUTOKO_MAP: MapDefinition = {
  id: 'shutoko-c1',
  name: '首都高（都心環状線）',
  tileSize: 20,
  roadWidth: 9,
  layout: [],
  start: { col: 0, row: 0, heading: 'E' },
  race: { laps: 1 },
  road: {
    scenery: 'highway',
    highway: { ground: -14, lanes: 2 },
    width: 9,
    start: 100,
    closed: true,
    // 銀座のゆるい左で京橋へ戻る（周回が閉じる長さを計算する）
    pieces: closeLoop(ROAD_ORIGIN, C1_PIECES, 120, 1, { h: 0 }),
    // 東京湾（南と西）
    sea: [
      [-1700, 60, 600, 800],
      [-1700, -700, -1010, 60],
    ],
  },
};

/**
 * 谷を橋で渡り、山をトンネルで抜ける 5km ほどの峠（高低差 230m）。橋は 3 か所（コーナーの続く区間の途中）、
 * トンネルは短いもの（90m）と長いもの（360m）が 1 本ずつ
 */
const VALLEY_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 11,
  start: 60,
  pieces: [
    { straight: 120, h: 0 },
    { arc: { radius: 50, turn: 70 } },
    { straight: 60 },
    { arc: { radius: 30, turn: -110 } },
    { straight: 60 },
    { straight: 150, bridge: true, valley: 35 },
    { straight: 40 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 70 },
    { arc: { radius: 25, turn: -150 } },
    { straight: 80 },
    { straight: 90, tunnel: true },
    { arc: { radius: 70, turn: 60 } },
    { straight: 100, h: 50 },
    { arc: { radius: 35, turn: -100 } },
    { straight: 60 },
    { arc: { radius: 60, turn: 80 } },
    { straight: 50 },
    { arc: { radius: 28, turn: -130 } },
    { straight: 60 },
    { straight: 180, bridge: true, valley: 45 },
    { straight: 40 },
    { arc: { radius: 45, turn: 100 } },
    { straight: 80 },
    { arc: { radius: 22, turn: -160 }, h: 95 },
    { straight: 90 },
    { arc: { radius: 80, turn: 50 } },
    { straight: 120 },
    { arc: { radius: 150, turn: -60 }, tunnel: true },
    { straight: 200, tunnel: true, h: 130 },
    { straight: 60 },
    { arc: { radius: 40, turn: 90 } },
    { straight: 70 },
    { arc: { radius: 30, turn: -120 } },
    { straight: 50 },
    { straight: 160, bridge: true, valley: 40 },
    { straight: 40 },
    { arc: { radius: 55, turn: 80 } },
    { straight: 90 },
    { arc: { radius: 24, turn: -150 }, h: 165 },
    { straight: 100 },
    { arc: { radius: 100, turn: 40 } },
    { straight: 80 },
    { arc: { radius: 35, turn: -100 } },
    { straight: 120, h: 190 },
    { arc: { radius: 60, turn: 90 } },
    { straight: 100 },
    { arc: { radius: 35, turn: -80 } },
    { straight: 70 },
    { arc: { radius: 45, turn: 80 } },
    { straight: 130 },
    { arc: { radius: 30, turn: -110 } },
    { straight: 90 },
    { arc: { radius: 80, turn: 60 } },
    { straight: 120 },
    { arc: { radius: 26, turn: -150 } },
    { straight: 120, h: 230 },
  ],
};

/** 橋とトンネルの峠を上る */
export const VALLEY_UP_MAP = roadMap('valley-up', '橋とトンネルの峠（ヒルクライム）', VALLEY_ROAD);
/** 橋とトンネルの峠を下る */
export const VALLEY_DOWN_MAP = roadMap('valley-down', '橋とトンネルの峠（ダウンヒル）', reverseRoad(VALLEY_ROAD, 60));

/**
 * 八方ヶ原のような、4 つの区間に分かれた峠の往復（オリジナル・道路 3.5km、往復 6.8km）。中心線で描く道路
 * （src/map/road.ts）。ふもとからスタートし、頂上の広場で U ターンして、同じ道を戻ってきたらゴール。
 *
 * - 第1セクション: 道幅の狭い古い道。木が道路のすぐ脇まで茂り、コーナーの先が見えない
 * - 第2セクション: 拡幅工事を終えた新設の広い道。両側に新しいガードレール、削った斜面は吹き付けたばかりのコンクリート。
 *   ただし路面は荒れていて、細かく波打って車が跳ねる
 * - ハイポイントコーナーを過ぎた第3セクション: きついダウンヒル。その先で高さ 55m の谷に架かる大きな橋を渡る
 * - 第4セクション: きついヒルクライム（道幅 10m で追い抜きやすい）。330° 回り込むループ橋（自分の下をくぐってきた道の上を越える）、
 *   カーブの途中にある 240m のトンネルを抜け、さらに上り切った先の平らな道を 200m ほど走って頂上の広場へ
 */
export const HAPPOGAHARA_MAP: MapDefinition = {
  id: 'happogahara',
  name: '八方ヶ原風の峠（往復）',
  tileSize: 20,
  roadWidth: 10,
  layout: [],
  start: { col: 0, row: 0, heading: 'E' },
  race: { laps: 1 },
  road: {
    scenery: 'touge',
    width: 8,
    start: 150,
    turnaround: { radius: 11 },
    pieces: [
      // 第1セクション: 狭く見通しの悪い古い道
      { straight: 200, width: 6.2, surface: 'old' },
      { arc: { radius: 40, turn: 70 }, width: 6.2, surface: 'old' },
      { straight: 40, width: 6.2, surface: 'old' },
      { arc: { radius: 30, turn: -95 }, width: 6.2, surface: 'old' },
      { straight: 30, width: 6.2, surface: 'old' },
      { arc: { radius: 55, turn: 60 }, width: 6.2, surface: 'old' },
      { arc: { radius: 35, turn: -80 }, width: 6.2, surface: 'old' },
      { straight: 50, width: 6.2, surface: 'old' },
      { arc: { radius: 28, turn: 110 }, width: 6.2, surface: 'old' },
      { straight: 35, width: 6.2, surface: 'old' },
      { arc: { radius: 45, turn: -70 }, width: 6.2, surface: 'old' },
      { straight: 60, width: 6.2, surface: 'old' },
      { arc: { radius: 32, turn: -60 }, width: 6.2, surface: 'old' },
      { arc: { radius: 60, turn: 85 }, width: 6.2, surface: 'old', h: 30 },
      // 第2セクション: 拡幅済みの広い新しい舗装。路面は荒れている
      { straight: 120, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 110, turn: -45 }, width: 10, surface: 'new', bumpy: true },
      { straight: 80, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 90, turn: 50 }, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 130, turn: -35 }, width: 10, surface: 'new', bumpy: true },
      { straight: 100, width: 10, surface: 'new', bumpy: true },
      { arc: { radius: 75, turn: 60 }, width: 10, surface: 'new', bumpy: true },
      { straight: 60, width: 10, surface: 'new', bumpy: true, h: 64 },
      // ハイポイントコーナー（いちばん高い所）
      { arc: { radius: 42, turn: -95 }, width: 10, surface: 'new', h: 70 },
      // 第3セクション: きついダウンヒル
      { straight: 60 },
      { arc: { radius: 35, turn: 120 } },
      { straight: 50 },
      { arc: { radius: 26, turn: -150 } },
      { straight: 60 },
      { arc: { radius: 40, turn: 110 } },
      { straight: 40 },
      { arc: { radius: 45, turn: -80 } },
      { straight: 50, h: 4 },
      // 谷に架かる高い橋
      { straight: 240, bridge: true, valley: 55, h: 0, width: 9 },
      // 第4セクション: きついヒルクライム
      { straight: 70, width: 10 },
      { arc: { radius: 60, turn: -40 }, width: 10 },
      { straight: 50, h: 10, width: 10 },
      // 330° 回り込むループ橋（くぐってきた道の上を越える）
      { arc: { radius: 22, turn: -330 }, bridge: true, width: 10 },
      { straight: 40, bridge: true, width: 10 },
      { straight: 20, h: 32, width: 10 },
      // カーブの途中のトンネル
      { arc: { radius: 80, turn: 110 }, tunnel: true, width: 10 },
      { straight: 90, tunnel: true, width: 10 },
      { arc: { radius: 45, turn: -70 }, width: 10 },
      { straight: 60, width: 10 },
      { arc: { radius: 35, turn: 90 }, width: 10 },
      { straight: 50, width: 10 },
      { arc: { radius: 50, turn: -60 }, width: 10 },
      { straight: 60, h: 95, width: 10 },
      // 頂上: 登り切った後、少し平らな道を走ってから U ターンの広場へ
      { straight: 50, h: 96, width: 10 },
      { arc: { radius: 160, turn: 25 }, width: 10 },
      { straight: 90, h: 96, width: 10 },
    ],
  },
};

/**
 * 秋名（榛名山）のダウンヒル（約 5km・高低差 330m）。頂上の旧料金所跡から、湖を背に伊香保側へ下る。
 * 実際の道の形のデータは使っておらず、原作・アニメ・アーケードで知られる区間の並びを再現している:
 *
 * - スタート直後: 緩い下りの直線から、中速の左右が続く
 * - 長い下りのストレートの先に、最初のヘアピン
 * - 中速〜低速の連続コーナー
 * - スケートセンター前のストレート（いちばん長い直線。パワーのある車はここで抜きにかかる）
 * - 5連続ヘアピン（左右交互）。どのヘアピンも内側の路肩に側溝があり、内側のタイヤを落とすと速く曲がれる（溝落とし）
 * - ヘアピンを抜けた後の中速区間と S 字、最後の直線でゴール
 */
export const AKINA_DOWN_MAP = roadMap('akina-down', '秋名（ダウンヒル）', {
  scenery: 'touge',
  width: 8,
  start: 40,
  startHeight: 330,
  pieces: [
    // スタート（旧料金所跡）: 緩い下り
    { straight: 200, h: 320 },
    { arc: { radius: 120, turn: -35 } },
    { straight: 120 },
    { arc: { radius: 70, turn: 60 } },
    { straight: 90 },
    { arc: { radius: 55, turn: -80 } },
    { straight: 150 },
    { arc: { radius: 150, turn: 40 } },
    // 長い下りのストレートの先の、最初のヘアピン
    { straight: 260 },
    { arc: { radius: 18, turn: -175 }, gutter: true },
    { straight: 110 },
    // 中速〜低速の連続コーナー
    { arc: { radius: 40, turn: 100 }, gutter: true },
    { straight: 80 },
    { arc: { radius: 30, turn: -120 }, gutter: true },
    { straight: 60 },
    { arc: { radius: 60, turn: 70 } },
    { straight: 70 },
    { arc: { radius: 25, turn: 140 }, gutter: true },
    { straight: 90 },
    { arc: { radius: 45, turn: -90 } },
    // スケートセンター前のストレート
    { straight: 450 },
    { arc: { radius: 220, turn: 20 } },
    { straight: 140 },
    // 5連続ヘアピン（左右交互・内側に側溝）
    { arc: { radius: 16, turn: -178 }, gutter: true },
    { straight: 70 },
    { arc: { radius: 15, turn: 178 }, gutter: true },
    { straight: 60 },
    { arc: { radius: 17, turn: -178 }, gutter: true },
    { straight: 65 },
    { arc: { radius: 15, turn: 178 }, gutter: true },
    { straight: 70 },
    { arc: { radius: 18, turn: -170 }, gutter: true },
    { straight: 120 },
    // ヘアピンを抜けた後の中速区間と S 字
    { arc: { radius: 80, turn: 60 } },
    { straight: 140 },
    { arc: { radius: 35, turn: -110 }, gutter: true },
    { straight: 100 },
    { arc: { radius: 50, turn: 80 } },
    { arc: { radius: 50, turn: -80 } },
    { straight: 120 },
    { arc: { radius: 28, turn: 130 }, gutter: true },
    { straight: 150 },
    { arc: { radius: 90, turn: -50 } },
    // 最後の直線でゴール
    { straight: 200, h: 0 },
  ],
});

/**
 * 妙義（妙義山）のヒルクライム（約 4.7km・高低差 290m）。妙義ナイトキッズのホームコース。
 * 道の形は、オーナーが用意した妙義のヒルクライムのコース図をなぞって、直線と円弧に置き換えている:
 *
 * - スタート直後: ふもとの中速の左右
 * - 道幅が狭く路面の荒れた、崖沿いの中低速の連続コーナー
 * - 細かく折り返す中低速の連続コーナーの先で、電球の形にぐるりと回り込むヘアピン
 * - 中速の S 字の連続
 * - 岩の崖が迫る、見通しの悪いヘアピンの 3 連続
 * - ゴールの手前の左右
 */
const MYOGI_UP_ROAD: RoadSpec = {
  scenery: 'touge',
  width: 8,
  start: 82,
  pieces: [
    // ふもと: スタートから、中速の左右
    { straight: 82.2 },
    { arc: { radius: 120, turn: 1.0 } },
    { straight: 59.7 },
    { arc: { radius: 120, turn: -4.6 } },
    { straight: 41.8 },
    { arc: { radius: 51.6, turn: 14.0 } },
    { straight: 7.7 },
    { arc: { radius: 34.2, turn: 47.7 } },
    { arc: { radius: 34.2, turn: 35.7 } },
    { straight: 28.8 },
    { arc: { radius: 120, turn: -1.1 } },
    { straight: 25.7 },
    { arc: { radius: 26.9, turn: -21.6 } },
    { arc: { radius: 26.9, turn: -58.4 } },
    { arc: { radius: 54.9, turn: -33.1 } },
    { straight: 1.3 },
    { arc: { radius: 120, turn: -18.3 } },
    { straight: 19.3 },
    { arc: { radius: 120, turn: -4.3 } },
    { straight: 30.8 },
    { arc: { radius: 120, turn: -14.2 } },
    { straight: 22.0 },
    { arc: { radius: 53.7, turn: -28.3 } },
    { straight: 4.0 },
    { arc: { radius: 35.0, turn: -24.1 } },
    { straight: 9.7 },
    { arc: { radius: 16.5, turn: 55.2 } },
    { arc: { radius: 16.5, turn: 90.0 } },
    { arc: { radius: 27.3, turn: 35.1 } },
    { straight: 34.3 },
    // 道幅が狭く路面の荒れた、崖沿いの中低速の連続コーナー
    { arc: { radius: 120, turn: -2.8 }, h: 40, width: 7, bumpy: true },
    { straight: 47.7, width: 7, bumpy: true },
    { arc: { radius: 94.4, turn: 6.3 }, width: 7, bumpy: true },
    { straight: 35.9, width: 7, bumpy: true },
    { arc: { radius: 19.7, turn: -51.3 }, width: 7, bumpy: true },
    { arc: { radius: 19.7, turn: -71.6 }, width: 7, bumpy: true },
    { arc: { radius: 28.9, turn: -49.4 }, width: 7, bumpy: true },
    { straight: 5.2, width: 7, bumpy: true },
    { arc: { radius: 120, turn: 4.4 }, width: 7, bumpy: true },
    { straight: 25.3, width: 7, bumpy: true },
    { arc: { radius: 76.7, turn: 13.4 }, width: 7, bumpy: true },
    { arc: { radius: 76.7, turn: 41.6 }, width: 7, bumpy: true },
    { straight: 5.2, width: 7, bumpy: true },
    { arc: { radius: 120, turn: 8.4 }, width: 7, bumpy: true },
    { straight: 15.3, width: 7, bumpy: true },
    { arc: { radius: 120, turn: -14.6 }, width: 7, bumpy: true },
    { straight: 13.0, width: 7, bumpy: true },
    { arc: { radius: 120, turn: 8.7 }, width: 7, bumpy: true },
    { straight: 32.9, width: 7, bumpy: true },
    { arc: { radius: 120, turn: 3.9 }, width: 7, bumpy: true },
    { straight: 37.9, width: 7, bumpy: true },
    { arc: { radius: 54.0, turn: -5.1 }, width: 7, bumpy: true },
    { straight: 0.6, width: 7, bumpy: true },
    // 細かく折り返す、中低速の連続コーナー
    { arc: { radius: 52.5, turn: -46.3 }, h: 95, width: 7, bumpy: true },
    { arc: { radius: 52.5, turn: -17.4 } },
    { straight: 25.2 },
    { arc: { radius: 120, turn: 7.4 } },
    { straight: 6.4 },
    { arc: { radius: 120, turn: 20.0 } },
    { straight: 14.4 },
    { arc: { radius: 101.8, turn: -6.6 } },
    { straight: 25.1 },
    { arc: { radius: 22.7, turn: -35.2 } },
    { arc: { radius: 22.7, turn: -55.2 } },
    { straight: 5.7 },
    { arc: { radius: 41.0, turn: -16.8 } },
    { arc: { radius: 41.0, turn: 53.2 } },
    { arc: { radius: 59.8, turn: -22.8 } },
    { straight: 8.0 },
    { arc: { radius: 120, turn: -18.4 } },
    { straight: 1.5 },
    { arc: { radius: 120, turn: -15.7 } },
    { straight: 30.1 },
    { arc: { radius: 103.0, turn: 7.6 } },
    { straight: 19.2 },
    { arc: { radius: 33.7, turn: 31.0 } },
    { straight: 3.1 },
    { arc: { radius: 28.9, turn: 65.4 } },
    { arc: { radius: 28.9, turn: 50.0 } },
    { straight: 22.8 },
    { arc: { radius: 59.7, turn: -3.7 } },
    { straight: 25.7 },
    { arc: { radius: 16.9, turn: -62.1 } },
    { arc: { radius: 16.9, turn: -67.5 } },
    { straight: 3.7 },
    { arc: { radius: 42.1, turn: -23.0 } },
    { straight: 13.7 },
    { arc: { radius: 15.9, turn: 55.0 } },
    { arc: { radius: 15.9, turn: 72.9 } },
    { straight: 21.8 },
    { arc: { radius: 36.4, turn: -1.3 } },
    { straight: 13.5 },
    { arc: { radius: 15.4, turn: -65.2 } },
    { arc: { radius: 15.4, turn: -79.6 } },
    { straight: 4.9 },
    // 電球の形にぐるりと回り込む、大きく曲がるヘアピン
    { arc: { radius: 120, turn: -8.0 }, h: 150 },
    { straight: 21.9 },
    { arc: { radius: 120, turn: 2.6 } },
    { straight: 35.0 },
    { arc: { radius: 89.1, turn: 17.0 } },
    { straight: 16.9 },
    { arc: { radius: 25.4, turn: 29.7 } },
    { arc: { radius: 25.4, turn: 67.0 } },
    { straight: 10.7 },
    { arc: { radius: 92.6, turn: 3.7 } },
    { straight: 11.8 },
    { arc: { radius: 54.9, turn: -34.8 } },
    { arc: { radius: 54.9, turn: -40.7 } },
    { straight: 0.9 },
    { arc: { radius: 54.1, turn: -33.5 } },
    { straight: 5.2 },
    { arc: { radius: 40.7, turn: -42.3 } },
    { arc: { radius: 40.7, turn: -44.8 } },
    { arc: { radius: 58.3, turn: -30.2 } },
    { straight: 20.8 },
    { arc: { radius: 22.7, turn: -6.4 } },
    { straight: 4.0 },
    { arc: { radius: 18.0, turn: 80.8 } },
    // 中速の S 字の連続
    { arc: { radius: 18.0, turn: 23.2 }, h: 180 },
    { straight: 24.2 },
    { arc: { radius: 120, turn: 2.0 } },
    { straight: 38.0 },
    { arc: { radius: 118.2, turn: 28.4 } },
    { straight: 1.8 },
    { arc: { radius: 107.1, turn: 18.6 } },
    { straight: 15.3 },
    { arc: { radius: 56.0, turn: 33.3 } },
    { arc: { radius: 56.0, turn: 41.3 } },
    { straight: 5.7 },
    { arc: { radius: 120, turn: -17.3 } },
    { straight: 23.9 },
    { arc: { radius: 120, turn: 2.0 } },
    { straight: 28.9 },
    { arc: { radius: 63.1, turn: 15.3 } },
    { straight: 24.6 },
    { arc: { radius: 20.8, turn: -60.3 } },
    { arc: { radius: 20.8, turn: -74.7 } },
    { arc: { radius: 23.2, turn: -45.0 } },
    { straight: 28.0 },
    { arc: { radius: 120, turn: -7.1 } },
    { straight: 33.3 },
    { arc: { radius: 120, turn: 14.3 } },
    { straight: 18.9 },
    { arc: { radius: 120, turn: 14.8 } },
    { straight: 37.5 },
    { arc: { radius: 35.2, turn: 41.9 } },
    { arc: { radius: 34.5, turn: 69.4 } },
    { arc: { radius: 34.5, turn: 30.7 } },
    { straight: 32.1 },
    { arc: { radius: 120, turn: 22.6 } },
    { straight: 35.5 },
    { arc: { radius: 45.7, turn: -15.2 } },
    { straight: 13.8 },
    { arc: { radius: 30.3, turn: -83.6 } },
    { arc: { radius: 30.3, turn: -40.1 } },
    { straight: 21.5 },
    { arc: { radius: 120, turn: 17.1 } },
    { straight: 2.1 },
    { arc: { radius: 113.2, turn: 30.1 } },
    { arc: { radius: 113.2, turn: 17.7 } },
    { straight: 12.8 },
    { arc: { radius: 120, turn: 22.4 } },
    { straight: 37.9 },
    { arc: { radius: 94.0, turn: 2.6 }, h: 225 },
    { straight: 2.5 },
    // 岩の崖が迫る、見通しの悪いヘアピンの 3 連続
    { arc: { radius: 86.3, turn: -36.3 }, blind: true, cut: 1 },
    { straight: 57.0, blind: true, cut: 1 },
    { arc: { radius: 16.8, turn: 78.7 }, blind: true, cut: 1 },
    { arc: { radius: 16.8, turn: 106.2 }, blind: true, cut: 1 },
    { straight: 62.6, blind: true, cut: -1 },
    { arc: { radius: 20.6, turn: -87.7 }, blind: true, cut: -1 },
    { arc: { radius: 20.6, turn: -45.8 }, blind: true, cut: -1 },
    { arc: { radius: 35.3, turn: -43.1 }, blind: true, cut: 1 },
    { straight: 171.2, blind: true, cut: 1 },
    { arc: { radius: 23.9, turn: 50.8 }, blind: true, cut: 1 },
    { arc: { radius: 23.9, turn: 42.3 }, blind: true, cut: 1 },
    { arc: { radius: 25.6, turn: 69.7 }, h: 265, blind: true, cut: 1 },
    { straight: 92.5, blind: true, cut: -1 },
    // ゴールの手前の左右
    { arc: { radius: 72.2, turn: -66.4 } },
    { arc: { radius: 72.2, turn: -3.2 } },
    { straight: 23.8 },
    { arc: { radius: 63.6, turn: 33.7 } },
    { straight: 9.2 },
    { arc: { radius: 31.7, turn: -32.0 } },
    { arc: { radius: 31.7, turn: -49.2 } },
    { straight: 3.2 },
    { arc: { radius: 111.8, turn: -15.5 } },
    { straight: 13.6 },
    { arc: { radius: 56.7, turn: 27.7 } },
    { arc: { radius: 56.7, turn: 40.4 } },
    { straight: 37.2 },
    { arc: { radius: 120, turn: -4.4 } },
    { straight: 54.5 },
    { arc: { radius: 60.0, turn: 1.0 } },
    { arc: { radius: 60.0, turn: 42.0 }, h: 290 },
    { straight: 9.4 },
    { arc: { radius: 73.3, turn: 16.6 } },
    { arc: { radius: 73.3, turn: -26.6 } },
    { straight: 5.2 },
  ],
};

/** 妙義を上る。崖沿いの狭く荒れた連続コーナー、電球の形のヘアピン、岩の崖が迫るヘアピンの 3 連続 */
export const MYOGI_UP_MAP = roadMap('myogi-up', '妙義（ヒルクライム）', MYOGI_UP_ROAD);

export const MAPS: readonly MapDefinition[] = [
  TOWN_MAP,
  SCHOOL_MAP,
  SHUTOKO_MAP,
  HILLCLIMB_MAP,
  DOWNHILL_MAP,
  PASS_OVER_MAP,
  UTURN_MAP,
  IROHA_UP_MAP,
  IROHA_DOWN_MAP,
  STEEP_UP_MAP,
  STEEP_DOWN_MAP,
  LONG_MAP,
  MARATHON_MAP,
  STRAIGHT_UP_MAP,
  STRAIGHT_DOWN_MAP,
  VALLEY_UP_MAP,
  VALLEY_DOWN_MAP,
  HAPPOGAHARA_MAP,
  AKINA_DOWN_MAP,
  MYOGI_UP_MAP,
];

/**
 * タイトル画面の後ろに映すコース: 練習用（街・教習所）を除いた、峠・首都高。
 * 起動が遅くならないよう、作るのに特に時間のかかる長いコース（超ロング・八方ヶ原・いろは坂）も除く
 */
export const TITLE_MAPS: readonly MapDefinition[] = MAPS.filter(
  (m) => ![TOWN_MAP, SCHOOL_MAP, MARATHON_MAP, HAPPOGAHARA_MAP, IROHA_UP_MAP, IROHA_DOWN_MAP].includes(m),
);
