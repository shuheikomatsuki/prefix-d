import type { TimeOfDay, Weather } from '../game/environment';
import { NPC_LEVELS, type NpcLevel, type RoughStyle } from './npcDriver';

/**
 * 1対1でバトルする名前付きのライバル。それぞれ自分の車と得意なコースを持つ。
 * バトルはライバルの得意なコースで、ライバルと横に並んでスタートする（自分の車は自由に選べる）。
 * 得意なコースはライバルごとに別々。
 */
export interface Rival {
  /** 変わらない id（勝ったかどうかの保存に使う） */
  id: string;
  name: string;
  /** 所属チーム */
  team: string;
  /** 車の id（VEHICLE_PRESETS） */
  car: string;
  /** 得意なコース（MapDefinition.id） */
  course: string;
  /** 得意な時間帯・天気。書いてあれば、この相手を選んだときの時間帯・天気を最初にこれにする（後の画面で変えられる） */
  conditions?: { time: TimeOfDay; weather: Weather };
  /** 強さ（NPC_LEVELS の id） */
  level: string;
  /** ラフプレー（コーナーの手前でぶつけてコースの外へ押し出す）ができるなら、そのやり方。バトルの前に、するかどうかを選べる */
  rough?: RoughStyle;
  /** ラフプレーの短い説明（選ぶ画面の「あり」に添える。書かなければ「ぶつけてくる」） */
  roughNote?: string;
  /** ラフプレーのやり方の説明（「◯◯は」に続く文。書かなければ、コーナーの手前で並びかけて押し出す説明） */
  roughHow?: string;
  /** キャラクターの紹介（1〜2文） */
  bio: string;
  /**
   * メニューに出す写真（public/ からのパス。例: 'rivals/takumi.jpg'）。書かなければ名前の頭文字の絵を出す。
   * 縦長（3:4 くらい）の画像がよい
   */
  photo?: string;
}

/** 弱い順（同じ強さの中は、おおよそ手ごわい順） */
export const RIVALS: readonly Rival[] = [
  { id: 'itsuki', name: '武内樹', team: '秋名スピードスターズ', car: 'ae85', course: 'pass-down', level: 'easy', bio: '拓海の親友で、秋名スピードスターズの元気担当。ハチロクを買ったつもりがハチゴーだったことで有名。' },
  { id: 'iketani', name: '池谷浩一郎', team: '秋名スピードスターズ', car: 's13', course: 'pass-up', level: 'easy', bio: '秋名スピードスターズのリーダー。走りより、真子とのデートに大遅刻した切ない恋の話のほうが語り草。' },
  { id: 'kenta', name: '中村賢太', team: '赤城レッドサンズ', car: 's14', course: 'pass-over-r', conditions: { time: 'night', weather: 'rain' }, level: 'normal', bio: '高橋啓介を「啓介さん」と慕う赤城レッドサンズの若手。S14で雨の夜の峠に挑む。' },
  { id: 'shingo', name: '庄司慎吾', team: '妙義ナイトキッズ', car: 'eg6', course: 'uturn', level: 'normal', rough: { duration: 3, cooldown: 7, push: 6, spin: 2 }, bio: '勝つためならぶつけることも辞さない妙義ナイトキッズのダーティーな走り屋。右手をハンドルに縛るガムテープデスマッチで知られる。' },
  { id: 'nakazato', name: '中里毅', team: '妙義ナイトキッズ', car: 'gtr', course: 'long-r', level: 'hard', bio: '「GT-Rこそ最強」と信じる妙義ナイトキッズのリーダー。肝心なところでアンダーステアを出す。' },
  { id: 'iwaki', name: '岩城清次', team: 'チームエンペラー', car: 'evo', course: 'iroha-up', level: 'hard', bio: 'ランエボIVで4WDのトラクションを武器にするチームエンペラーのナンバー2。負けたあとに京一から受けるビンタまでがお約束。' },
  { id: 'sakamoto', name: '坂本', team: '埼玉北西エリア連合', car: 'cappuccino', course: 'steep-down', conditions: { time: 'night', weather: 'rain' }, level: 'hard', bio: '埼玉北西エリア連合のカプチーノ使い。軽さを武器にした下りの速さは、軽自動車だと侮ると痛い目を見る。' },
  { id: 'keisuke', name: '高橋啓介', team: '赤城レッドサンズ', car: 'fd3s', course: 'valley-up', level: 'hard', bio: '黄色いFDを駆る赤城レッドサンズのナンバー2で、のちのプロジェクトDのヒルクライム担当。何かにつけて口にするのは「アニキ」。' },
  { id: 'sudo', name: '須藤京一', team: 'チームエンペラー', car: 'evo3', course: 'iroha-down', level: 'hard', bio: '群馬の走り屋を見下すチームエンペラーのリーダー。副業でラーメン屋を営んでいて、負けた部下にはビンタ。' },
  { id: 'ryosuke', name: '高橋涼介', team: '赤城レッドサンズ', car: 'fc3s', course: 'valley-down', conditions: { time: 'night', weather: 'clear' }, level: 'legend', bio: '「赤城の白い彗星」と呼ばれる赤城レッドサンズのリーダーで、啓介の兄。白いFCで、理論に裏打ちされた隙のない走りを見せる。' },
  { id: 'hoshino', name: '星野好造', team: 'パープルシャドウ', car: 'r34', course: 'shutoko-c1', level: 'legend', bio: '「ゴッドフット」の異名を持つパープルシャドウのGT-R使い。「ゴッドアーム」城島と並ぶ伝説で、年季の違うアクセルワークを見せつける。' },
  { id: 'tachi', name: '舘智幸', team: 'プロレーサー', car: 'ek9', course: 'happogahara', level: 'legend', rough: { duration: 2.5, cooldown: 10, push: 2.5, spin: 0.7, upset: 0.4, side: 1.4, reach: 3.6 }, roughNote: '軽く当ててくる', roughHow: '後ろからコーナーの内側へ入り、軽く当てて姿勢を崩してくる。スピンするほどではないが、乱されたら立て直して', bio: '元走り屋のプロレーサーで、EK9シビックを操る。「プロとアマの差」を見せつけるためなら、軽く当てて相手を崩すこともためらわない。' },
  { id: 'rin', name: '北条凛', team: '死神', car: 'gtr', course: 'marathon', level: 'legend', rough: { duration: 3, cooldown: 9, push: 6, spin: 1.6 }, bio: '最愛の人を失い「死神」と呼ばれるようになった黒いGT-Rの男。相手を道連れにするような危険な走りで迫ってくる。' },
  { id: 'takumi', name: '藤原拓海', team: '藤原とうふ店', car: 'ae86', course: 'akina-down', level: 'legend', bio: '豆腐の配達で毎朝秋名を下るうちに腕を磨いた、とうふ屋のハチロク。紙コップの水をこぼさない走りと溝落としが代名詞。' },
];

export function rivalLevel(rival: Rival): NpcLevel {
  return NPC_LEVELS.find((l) => l.id === rival.level) ?? NPC_LEVELS[NPC_LEVELS.length - 1];
}

/** ライバルの強さの段階の番号（0 = 初級） */
function tierOf(rival: Rival): number {
  return Math.max(0, NPC_LEVELS.findIndex((l) => l.id === rival.level));
}

/**
 * ライバルとバトルできるか。初級はいつでも、それより上は、1つ下までの段階のライバルを全員倒すと解放される
 */
export function isRivalUnlocked(rival: Rival, beaten: ReadonlySet<string>, rivals: readonly Rival[] = RIVALS): boolean {
  const tier = tierOf(rival);
  return rivals.every((r) => tierOf(r) >= tier || beaten.has(r.id));
}

/** 解放されていないライバルを解放するのに、まだ倒していない相手（解放されていれば空） */
export function rivalsToUnlock(rival: Rival, beaten: ReadonlySet<string>, rivals: readonly Rival[] = RIVALS): Rival[] {
  const tier = tierOf(rival);
  return rivals.filter((r) => tierOf(r) < tier && !beaten.has(r.id));
}

/** バトルの条件（WIN を記録するかを決める） */
export interface BattleTerms {
  course: string;
  time: TimeOfDay;
  weather: Weather;
  /** ラフプレーを「あり」にしたか */
  rough: boolean;
}

/** WIN の条件のうち、満たしていないもの（満たしていれば空） */
export type MissedTerm = 'course' | 'time' | 'weather' | 'rough';

/**
 * 勝ったときに WIN として記録する条件: ライバルの得意なコースで、得意な時間帯・天気があればそれで、
 * ラフプレーができるライバルなら「あり」にして勝つこと
 */
export function missedTerms(rival: Rival, terms: BattleTerms): MissedTerm[] {
  const out: MissedTerm[] = [];
  if (terms.course !== rival.course) out.push('course');
  if (rival.conditions && terms.time !== rival.conditions.time) out.push('time');
  if (rival.conditions && terms.weather !== rival.conditions.weather) out.push('weather');
  if (rival.rough && !terms.rough) out.push('rough');
  return out;
}

const BEATEN_KEY = 'car-game:beaten-rivals';

/** 勝ったことのあるライバルの id */
export function loadBeatenRivals(): Set<string> {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(BEATEN_KEY) ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markRivalBeaten(id: string): void {
  const set = loadBeatenRivals();
  set.add(id);
  try {
    localStorage.setItem(BEATEN_KEY, JSON.stringify([...set]));
  } catch {
    // 保存できなくても遊ぶのには困らない
  }
}
