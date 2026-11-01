import { buildRoad } from '../map/road';
import { type MapDefinition, parseMap } from '../map/tilemap';
import { buildRoadCourse } from '../race/roadCourse';

/** メニューのコースの説明に出す、コースの形と高低差（描画に依存しない） */
export interface CourseProfile {
  /** 周回・一本道・往復（行って戻る）・自由に走る（コースのない街など） */
  kind: 'loop' | 'oneway' | 'roundtrip' | 'free';
  /** コースの長さ [m]（1周・ゴールまで。自由に走るマップは 0） */
  length: number;
  laps: number;
  /** 上から見たコースの中心線の点（自由に走るマップは空） */
  outline: { x: number; z: number }[];
  /** スタートからゴールまで等間隔に並べた高さ [m] */
  heights: number[];
  /** いちばん低い所と高い所の差 [m] */
  rise: number;
  /** 上りの合計 [m] */
  climb: number;
  /** いちばん急な坂の勾配 [%] */
  maxGrade: number;
  /** 道幅の最小と最大 [m] */
  width: { min: number; max: number };
  /** 橋・トンネルなど、コースの目立つ特徴 */
  features: string[];
}

/** 高低差のグラフの点の数 */
const PROFILE_POINTS = 160;
/** 上から見た形の点の数 */
const OUTLINE_POINTS = 400;

const cache = new Map<string, CourseProfile>();

/** マップのコースの形と高低差（一度求めたら覚えておく） */
export function courseProfile(def: MapDefinition): CourseProfile {
  const cached = cache.get(def.id);
  if (cached) return cached;
  const profile = computeProfile(def);
  cache.set(def.id, profile);
  return profile;
}

function computeProfile(def: MapDefinition): CourseProfile {
  if (!def.road) {
    // タイルの街・教習所: コースはなく、自由に走る
    return { kind: 'free', length: 0, laps: 0, outline: [], heights: [], rise: 0, climb: 0, maxGrade: 0, width: { min: def.roadWidth, max: def.roadWidth }, features: [] };
  }
  const road = buildRoad(def.road);
  const course = buildRoadCourse(parseMap(def), road);
  const length = course.length;
  const outline = Array.from({ length: OUTLINE_POINTS + 1 }, (_, i) => {
    const p = course.pointAt((length * i) / OUTLINE_POINTS);
    return { x: p.x, z: p.z };
  });
  const heights = Array.from({ length: PROFILE_POINTS + 1 }, (_, i) => course.heightAt((length * i) / PROFILE_POINTS));
  let climb = 0;
  let maxGrade = 0;
  const step = 10;
  for (let s = 0; s + step <= length; s += step) {
    const dh = course.heightAt(s + step) - course.heightAt(s);
    if (dh > 0) climb += dh;
    maxGrade = Math.max(maxGrade, Math.abs(dh) / step);
  }
  let minW = Infinity;
  let maxW = 0;
  for (let i = 0; i < road.count; i++) {
    minW = Math.min(minW, road.width[i]);
    maxW = Math.max(maxW, road.width[i]);
  }
  const { pieces } = def.road;
  const features: string[] = [];
  const bridges = pieces.filter((p) => p.bridge && !pieces[pieces.indexOf(p) - 1]?.bridge).length;
  if (bridges) features.push(`橋 ${bridges}`);
  if (pieces.some((p) => p.tunnel)) features.push('トンネル');
  if (pieces.some((p) => p.bumpy)) features.push('荒れた路面');
  const hairpins = pieces.filter((p) => p.arc && Math.abs(p.arc.turn) >= 140 && p.arc.radius <= 40).length;
  if (hairpins) features.push(`ヘアピン ${hairpins}`);
  if (def.shortcuts) features.push('近道あり');
  if (road.layer.some((l) => l !== 0)) features.push('立体交差');
  const kind = course.closed ? 'loop' : def.road.turnaround ? 'roundtrip' : 'oneway';
  return {
    kind,
    length,
    laps: def.race?.laps ?? 1,
    outline,
    heights,
    rise: Math.max(...heights) - Math.min(...heights),
    climb,
    maxGrade: maxGrade * 100,
    width: { min: minW, max: maxW },
    features,
  };
}

/**
 * メニューに出すコースの短い説明と、おすすめの車（VEHICLE_PRESETS の id）。
 * おすすめは、レーシングラインを限界で走ったときの理論タイムが速い車から、コースの性格に合うもの
 * （高速コースはパワーと最高速、下りやヘアピンの続くコースは軽さとブレーキ）を選ぶ。
 * どれもそのコースの最速から 4% 以内（courseInfo.sim.test.ts で確かめる。車の性能を変えたら見直す）
 */
export interface CourseNote {
  text: string;
  cars: readonly string[];
}

export const COURSE_NOTES: Record<string, CourseNote> = {
  town: { text: '最初の練習用の小さな街。交差点と標識のある道を、のんびり走れる', cars: ['standard', 'kei'] },
  school: { text: '教習所のような練習コース。S字・クランク風の連続カーブと交差点', cars: ['kei', 'standard'] },
  'shutoko-c1': { text: '都心環状線のような高架の2車線。長い直線はなく、江戸橋・谷町・浜崎橋のきつい左とS字、千代田トンネル。両側は壁', cars: ['fd3s', 'evo'] },
  'pass-up': { text: '頂上まで150m上る。高速コーナー、S字、3つのヘアピン', cars: ['fd3s', 'evo'] },
  'pass-down': { text: '同じ峠を頂上から下る。スピードが乗るので早めのブレーキが大事', cars: ['fd3s', 'ae86'] },
  'pass-over-r': { text: '100mあまり上って峠を越え、反対側へ下る。頂上は見通しのよい高速の左右', cars: ['fd3s', 'evo'] },
  uturn: { text: '谷沿いに上り、頂上のヘアピンで折り返して横を並んで下る', cars: ['fd3s', 'evo'] },
  'iroha-up': { text: '第二いろは坂（上り専用）。谷沿いの高速区間から、12個のヘアピンを積み重ねて明智平へ上る。20カーブ', cars: ['fd3s', 'evo'] },
  'iroha-down': { text: '第一いろは坂（下り専用）。28カーブ。つづら折りのヘアピンの内側を突っ切って段差から飛び降りる近道がある', cars: ['fd3s', 'ae86'] },
  'steep-up': { text: '平均17%の急坂。パワーのない車は伸びなくなる', cars: ['evo', 'fd3s'] },
  'steep-down': { text: '同じ激坂を下る。ブレーキが遅れるとコーナーで止まりきれない', cars: ['ae86', 'ek9'] },
  'long-r': { text: '上りと下りを何度もくり返す。高速コーナーとヘアピンが交互に来る', cars: ['r34', 'fd3s'] },
  marathon: { text: 'いちばん長いコース。集中力を切らさずに走りきる', cars: ['fd3s', 'r34'] },
  'straight-up-r': { text: '800mの直線と、ごく僅かにくねる650mの直線のある峠を上る', cars: ['r34', 'gtr'] },
  'straight-down-r': { text: '同じ峠を下る。長い直線の先のコーナーで速度を落としきれるか', cars: ['r34', 'gtr'] },
  'valley-up': { text: '3回谷を橋で渡り、短いトンネルと長いトンネルを抜けて上る', cars: ['r34', 'evo'] },
  'valley-down': { text: '橋とトンネルの峠を下る。トンネルの出口の先のコーナーに注意', cars: ['fd3s', 'evo'] },
  'akina-down': {
    text: '秋名のダウンヒル。長いストレート、スケートセンター前の直線、5連続ヘアピン。ヘアピンの内側の側溝にタイヤを落とせば溝落とし',
    cars: ['fd3s', 'evo'],
  },
  'myogi-up': {
    text: '妙義ナイトキッズのホーム。狭く荒れた崖沿いの連続コーナー、電球の形に回り込むヘアピン、岩の崖が迫るヘアピンの 3 連続',
    cars: ['r34', 'fd3s'],
  },
  happogahara: {
    text: '狭い古い道、荒れた広い道、谷に架かる橋、ループ橋とトンネルのヒルクライム。頂上の広場でUターンして戻る',
    cars: ['fd3s', 'evo'],
  },
};

/** 高低差のグラフを幅 w・高さ h の枠に描くための点（左下が原点ではなく、canvas と同じ左上が原点） */
export function profilePath(heights: readonly number[], w: number, h: number, pad = 4): { x: number; y: number }[] {
  if (!heights.length) return [];
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  // 平らなコースでも線が真ん中に来るよう、高さの幅は最低 20m とみなす
  const span = Math.max(20, max - min);
  const mid = (min + max) / 2;
  return heights.map((v, i) => ({
    x: pad + ((w - 2 * pad) * i) / Math.max(1, heights.length - 1),
    y: h / 2 - ((v - mid) / span) * (h - 2 * pad),
  }));
}
