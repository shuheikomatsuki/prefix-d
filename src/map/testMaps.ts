import { ROAD_ORIGIN, type RoadPiece, closeLoop } from './road';
import type { MapDefinition } from './tilemap';

/**
 * テスト用のタイルのマップ。ゲームのコースは中心線で描く道路に作り直したが、タイルのコースの仕組み
 * （src/race/course.ts・src/map/obstacles.ts など）を確かめるために、前のタイルのレイアウトを残しておく
 */

/**
 * タイムアタック用の周回サーキット。交差点はなく、一周が1本道。
 * 速度を出せるよう、タイルを大きく（カーブの半径 20m）、道幅を広くしている。
 */
export const CIRCUIT_MAP: MapDefinition = {
  id: 'circuit',
  name: 'サーキット',
  tileSize: 40,
  roadWidth: 16,
  layout: [
    '...............',
    '.RRRRRRRRRRRRR.',
    '.R..T.....T..R.',
    '.R..RRRRR....R.',
    '.R..R.T.R..T.R.',
    '.RRRR...R..RRR.',
    '..T.....R..R...',
    '...RRRRRR..R.T.',
    '...R..B..T.R...',
    '...RRRRRRRRR...',
    '...............',
  ],
  start: { col: 6, row: 1, heading: 'E' },
  guardrails: true,
  race: { laps: 3 },
};


/** 短い直線とコーナーが続く周回コース。カーブの半径は 15m と小さめ */
export const TECHNICAL_MAP: MapDefinition = {
  id: 'technical',
  name: 'テクニカルコース',
  tileSize: 30,
  roadWidth: 14,
  layout: [
    '.................',
    '.RRRRR..T..RRRRR.',
    '.R.T.R.....R.T.R.',
    '.R...RRR.RRR...R.',
    '.R..T..R.R..T..R.',
    '.RRR...RRR...RRR.',
    '...R..T...T..R...',
    '.RRR..RRRRR..RRR.',
    '.R....R.B.R....R.',
    '.R..RRR...RRR..R.',
    '.R..R..T.T..R..R.',
    '.RRRR.......RRRR.',
    '.................',
  ],
  start: { col: 8, row: 7, heading: 'E' },
  guardrails: true,
  race: { laps: 2 },
};


/** 峠道のレイアウト。左下の行き止まりがふもと、左上の行き止まりが頂上 */
const PASS_LAYOUT = [
  '...................',
  '.RRRRRR..T....T....',
  '..T...R..RRRR...T..',
  '......R..R..R......',
  '.T....RRRR..R..T...',
  '....T.......R......',
  '..RRRRRR..RRR...T..',
  '..R....R..R...T....',
  '..R..T.RRRR.....T..',
  '..R.........T......',
  '..RRRR..RRRRRRRRR..',
  '.T...R..R..T....R..',
  '.....RRRR...RRRRR..',
  '..T.....T...R...T..',
  '..RRRRRRRRRRR......',
  '...................',
];
const PASS_ELEVATION = { from: { col: 2, row: 14 }, rise: 150 };
/** ふもとから頂上まで上る一本道。坂で車が重くなる */
export const HILLCLIMB_MAP: MapDefinition = {
  id: 'hillclimb',
  name: '峠（ヒルクライム）',
  tileSize: 30,
  roadWidth: 11,
  layout: PASS_LAYOUT,
  start: { col: 5, row: 14, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: PASS_ELEVATION,
};


/** 同じ峠を頂上から下る。スピードが乗るので早めのブレーキが大事 */
export const DOWNHILL_MAP: MapDefinition = {
  id: 'downhill',
  name: '峠（ダウンヒル）',
  tileSize: 30,
  roadWidth: 11,
  layout: PASS_LAYOUT,
  start: { col: 4, row: 1, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: PASS_ELEVATION,
};


/** 川を4回渡る周回コース。橋の上は欄干に囲まれ、川岸には柵がある */
export const RIVERSIDE_MAP: MapDefinition = {
  id: 'riverside',
  name: '川と橋のコース',
  tileSize: 30,
  roadWidth: 12,
  layout: [
    '.........~~.........',
    '.RRRRRRRR==RRRRRRRR.',
    '.R.......~~.......R.',
    '.R..T....~~...T...R.',
    '.R.RRRRRR==RRRRRRRR.',
    '.R.R.....~~.....T...',
    '.R.R..T..~~.........',
    '.R.RRRRRR==RRRRRRRR.',
    '.R.......~~.......R.',
    '.R...T...~~...T...R.',
    '.RRRRRRRR==RRRRRRRR.',
    '.........~~.........',
  ],
  start: { col: 4, row: 1, heading: 'E' },
  guardrails: true,
  race: { laps: 2 },
};


const HAIRPIN_LAYOUT = [
  '.............',
  '.............',
  '......RRR....',
  '..T...R......',
  '......R...T..',
  '...RRRR......',
  '...R.........',
  '...RRRRRRRR..',
  'T.........R.T',
  '....RRRRRRR..',
  '....R........',
  '.T..RRRRRR...',
  '.........R...',
  '..RRRRRRRR...',
  '..R..........',
  '..RRRRRRR....',
  '........R...T',
  '...RRRRRR....',
  '...R.........',
  '...RRRRRRRR..',
  '..........R..',
  '.T...RRRRRR..',
  '.T...R.......',
  '..RRRR....T..',
  '.............',
  '...T.........',
];

const HAIRPIN_DOWN_LAYOUT = [
  '.............',
  '.............',
  '......RRRRR..',
  '..T...R......',
  '......R...T..',
  '...RRRR......',
  '...R.........',
  '...RRRRRRRR..',
  'T.........R.T',
  '....RRRRRRR..',
  '....R........',
  '.T..RRRRRR...',
  '.........R...',
  '..RRRRRRRR...',
  '..R..........',
  '..RRRRRRR....',
  '........R...T',
  '...RRRRRR....',
  '...R.........',
  '...RRRRRRRR..',
  '..........R..',
  '.T...RRRRRR..',
  '.T...R.......',
  '..RRRR....T..',
  '.............',
  '...T.........',
];

/** 斜面をつづら折りで上る。ヘアピンが十数個続く */
export const HAIRPIN_MAP: MapDefinition = {
  id: 'hairpin',
  name: 'つづら折り（ヒルクライム）',
  tileSize: 22,
  roadWidth: 10,
  layout: HAIRPIN_LAYOUT,
  start: { col: 4, row: 23, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: { from: { col: 2, row: 23 }, rise: 150 },
};

/**
 * つづら折りを上から下る。ヘアピンの内側には段差のある近道の帯があり、
 * 内側の内側を攻める「地元走り」ができる（段差で少し宙に浮く）
 */
export const HAIRPIN_DOWN_MAP: MapDefinition = {
  id: 'hairpin-down',
  name: 'つづら折り（ダウンヒル）',
  tileSize: 22,
  roadWidth: 10,
  layout: HAIRPIN_DOWN_LAYOUT,
  start: { col: 8, row: 2, heading: 'W' },
  guardrails: true,
  race: { laps: 1 },
  elevation: { from: { col: 2, row: 23 }, rise: 160 },
  shortcuts: true,
};

/**
 * 谷を橋で渡り、山をトンネルで抜ける 5km あまりの峠。橋は 3 か所（コーナーの続く区間の途中）、
 * トンネルは短いもの（90m）と長いもの（360m）が 1 本ずつ。左下の行き止まりがふもと、右上の行き止まりが頂上
 */
const VALLEY_LAYOUT = [
    '.T....T.TTT...............................T.....TT.....',
    '.....T.........T.RRRRRR############RR.T...........RRRR.',
    '..TTT..T....T....R..................R.T........~..R....',
    '...T.T.......TTT.RRRR.........T.....R....T.TT..~..RRR..',
    'T......TT...........R....T........RRR.T........~....R..',
    '..TT...TT....T......RRR..T........R........RRR===RR.R..',
    '.TT.T.T...T......T.T..R.....TT....RRRR..T..R...~..R.R.T',
    '.T...T................R..T.T.........R.....RRR.~..RRR..',
    '.......T.RRRR###RR..RRR.....TT.......RRR.....R.........',
    'T........R.......R..R......TT.T....~...R.....RRRR...T..',
    '...T.....RRRRR...RRRR...T........T.~.RRR........R...TT.',
    '.......TT....R.............T.......~.R..T..TT...R......',
    '.T.........RRR.....T.TTT.T......RR===R.......T..R......',
    'TT.T.......R....T..T.........T..R.........RRR...R.T..T.',
    '..T........R......T...TT....TT..RRRRR.....R.R...R..TTT.',
    '...........RRRR.........T...........R.....R.R...R......',
    '.....RRR......R........T............R.....R.R.RRR......',
    '.....R.R...~..R...T....T.T.T..T..RRRR..RRRR.R.R..T.T...',
    '.RRRRR.RRR===RR...T..T..T.T..T...R.....R....R.R.....T..',
    'T.....T....~...T.........TTT.....RRRRRRR....RRR.T.T.T..',
    '..T........~.......TT..........TT..........T.....TTT.TT',
];
const VALLEY_ELEVATION = { from: { col: 1, row: 18 }, rise: 230 };

/** 橋とトンネルの峠を上る */
export const VALLEY_UP_MAP: MapDefinition = {
  id: 'valley-up',
  name: '橋とトンネルの峠（ヒルクライム）',
  tileSize: 30,
  roadWidth: 11,
  layout: VALLEY_LAYOUT,
  start: { col: 3, row: 18, heading: 'E' },
  guardrails: true,
  race: { laps: 1 },
  elevation: VALLEY_ELEVATION,
};

/** 前の首都高の最後: 215° ほど曲がり続ける大きなカーブでロングストレートに戻る（周回が閉じる長さを計算する） */
function closeStackedLoop(pieces: RoadPiece[]): RoadPiece[] {
  const out = closeLoop(ROAD_ORIGIN, pieces, 200, 1);
  out[out.length - 1] = { ...out[out.length - 1], h: 0 };
  return out;
}

/**
 * 前の首都高（湾岸線・ループ）。ゲームのコースは都心環状線のような形に作り直したが、自分の上を重なって回る
 * 二重のループ・吊り橋・海のある高架の道路を確かめるために残しておく。高架の周回コース（約 5.9km）。中心線で描く道路（src/map/road.ts）なので、
 * カーブはなめらかな円で、道路が自分の上を越える立体交差がある。
 *
 * 湾岸線のような 1.3km のロングストレートの先で、左に 540° 回りながら上る二重のループ（下の輪の真上を
 * 上の輪が通る）、海を渡る吊り橋（レインボーブリッジ）、都心環状線のような曲がりくねった区間、
 * 405° 回って自分の上を越えていくループ、200° あまり曲がり続ける大きなカーブを通ってロングストレートに戻る。
 * 道路の両側は壁で、3車線
 */
export const STACKED_LOOP_MAP: MapDefinition = {
  id: 'shutoko-loop-2',
  name: '首都高（湾岸線・ループ）',
  tileSize: 20,
  roadWidth: 11,
  layout: [],
  start: { col: 0, row: 0, heading: 'E' },
  race: { laps: 1 },
  road: {
    scenery: 'highway',
    highway: { ground: -14, lanes: 3 },
    width: 11,
    start: 100,
    closed: true,
    pieces: closeStackedLoop([
      // 湾岸線のロングストレート
      { straight: 1300 },
      { arc: { radius: 500, turn: -20 } },
      { straight: 200, h: 0 },
      // 左に 540° 回りながら上る二重のループ
      { arc: { radius: 65, turn: 540 }, width: 10, h: 16 },
      { straight: 250, h: 22 },
      // レインボーブリッジ
      { straight: 120, h: 24 },
      { straight: 620, suspension: true, h: 26 },
      { straight: 150, h: 16 },
      // 都心環状線のような曲がりくねった区間（百数十キロで曲がれるくらいの半径）
      { arc: { radius: 90, turn: 70 }, width: 9 },
      { straight: 100, width: 9 },
      { arc: { radius: 80, turn: -90 }, width: 9 },
      { straight: 60, width: 9 },
      { arc: { radius: 100, turn: 80 }, width: 9 },
      { arc: { radius: 80, turn: -60 }, width: 9, h: 6 },
      { straight: 150, width: 9, h: 6 },
      // 405° 回って、自分の上を越えていくループ
      { arc: { radius: 60, turn: 405 }, width: 9, h: 18 },
      { straight: 200, width: 10, h: 8 },
      { arc: { radius: 90, turn: -60 } },
    ]),
    // 東京湾（北側）と、吊り橋の下の運河
    sea: [
      [-900, -1400, 2100, -470],
      [880, -470, 1500, -45],
    ],
  },
};
