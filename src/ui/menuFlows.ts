import { TIMES_OF_DAY, type TimeOfDay, WEATHERS, type Weather, defaultOpponentLights } from '../game/environment';
import type { Level } from '../game/level';
import { BATTLE_RULES, type BattleRule, NPC_COUNT, type RaceMode } from '../game/modes';
import { MAPS } from '../map/maps';
import type { RaceSettings, RaceState } from '../net/protocol';
import { CarPreview } from '../render/carPreview';
import { RIVAL_DIALOGUES } from '../race/dialogueScript';
import { NPC_LEVELS } from '../race/npcDriver';
import { RIVALS, type Rival, loadBeatenRivals, rivalLevel } from '../race/rivals';
import { SAFE_SECONDS } from '../race/suddenDeath';
import type { TimeAttack } from '../race/timeAttack';
import { VEHICLE_PRESETS, topSpeedOf } from '../sim/vehicle';
import { driveOf } from './carStats';
import { courseProfile } from './courseInfo';
import { GameMenu, type MenuGroup, type MenuItem, type MenuMode, type MenuScreen } from './menu';
import { carDetail, conditionsDetail, courseDetail, npcDetail, rivalDetail, textDetail } from './menuDetails';
import { settingDetail } from './settingsItems';

/** メニューで選ぶ内容（最後に「スタート」を押したときに反映する） */
export interface MenuChoices {
  map: string;
  car: string;
  npc: string;
  rival: string;
  rule: BattleRule;
  rough: boolean;
  time: TimeOfDay;
  weather: Weather;
  opponentLights: boolean;
}

/** メニューから見たゲームの様子と、メニューからできること */
export interface MenuContext {
  level: () => Level;
  race: () => TimeAttack | null;
  raceMode: () => RaceMode;
  /** いま走っているレースの名前（「NPC対戦（強い）」など） */
  raceLabel: () => string;
  /** いまの車・相手・時間帯など（選び始めるときの下書きになる。map はいまのマップ） */
  current: () => MenuChoices;
  /** 選んだ内容を反映して、そのモードで始める */
  apply: (mode: RaceMode | 'free', choices: MenuChoices) => void;
  startRace: (mode: RaceMode) => void;
  stopRace: () => void;
  resetCar: () => void;
  openRanking: () => void;
  /** ランキングのサーバーがあるか */
  hasRanking: boolean;
  toast: (message: string) => void;
  online: {
    /** オンライン用のサーバーがあるか */
    available: boolean;
    isOnline: () => boolean;
    selfId: () => number | null;
    roomCode: () => string;
    roomRace: () => RaceState | null;
    nameOf: (id: number) => string;
    /** 部屋に入る画面を開く */
    openJoin: (note: string) => void;
    /** 対戦のエントリー画面を開く */
    openEntry: () => void;
    /** 対戦を言い出す（コースと時間帯・天気） */
    openRace: (settings: RaceSettings) => void;
    leaveRoom: () => void;
  };
  settings: readonly MenuItem[];
  /** メニューを開いた・閉じた */
  onOpenChange: (open: boolean) => void;
  /** Esc で開いてよいか（他の画面を開いているときは開かない） */
  canOpen: () => boolean;
}

const carLabel = (id: string) => VEHICLE_PRESETS.find((v) => v.id === id)?.label ?? id;
const mapLabel = (id: string) => MAPS.find((m) => m.id === id)?.name ?? id;
const timeLabel = (id: TimeOfDay) => TIMES_OF_DAY.find((t) => t.id === id)!.label;
const weatherLabel = (id: Weather) => WEATHERS.find((w) => w.id === id)!.label;
/** ライバルの得意な時間帯・天気の書き方（「夜・雨」。なければ空） */
const rivalConditionsLabel = (r: Rival) => (r.conditions ? `${timeLabel(r.conditions.time)}・${weatherLabel(r.conditions.weather)}` : '');

/** プレイモードの説明。後ろに薄く大きく、英語の最初の語（big で変えられる）を出す */
const modeDetail =
  (title: string, en: string, lines: string[], big = en.split(' ')[0]) =>
  () =>
    // コース・車・時間帯はこの後の画面で選ぶので、ここには出さない
    textDetail({ kicker: en, title, big, lines });

/**
 * ゲームのメニューを作る: タイトル → トップ画面でプレイモードを選び、コース・対戦相手・車などを順に選ぶ（走っている間は Esc / ☰ でポーズ）。
 * openChangeFlow は、いまのレースのモードのまま選び直す画面を開く（ポーズ画面・ゴールの画面から）
 */
export function createGameMenu(c: MenuContext): { menu: GameMenu; openChangeFlow: () => void } {
  const raceMaps = MAPS.filter((m) => m.race);
  const online = c.online;
  /** メニューで選んでいる途中の内容 */
  const draft: MenuChoices = c.current();
  const draftMap = () => MAPS.find((m) => m.id === draft.map) ?? MAPS[0];
  const draftCar = () => VEHICLE_PRESETS.find((v) => v.id === draft.car) ?? VEHICLE_PRESETS[0];
  const draftRival = () => RIVALS.find((r) => r.id === draft.rival) ?? RIVALS[0];
  const draftNpc = () => NPC_LEVELS.find((l) => l.id === draft.npc) ?? NPC_LEVELS[0];
  /** 車の見た目（メニューの右側で回して見せる） */
  const carPreview = new CarPreview();
  /** 選び始めたときの時間帯・天気（得意な条件のないライバルに選び直したら、これに戻す） */
  let draftBaseEnv = { time: draft.time, weather: draft.weather };
  /** 選び始めるときに、下書きを今の状態にする（レースならレース用のコースから選ぶ） */
  const beginDraft = (raceOnly: boolean) => {
    Object.assign(draft, c.current());
    if (raceOnly && !c.level().def.race) draft.map = raceMaps[0].id;
    draftBaseEnv = { time: draft.time, weather: draft.weather };
  };
  /** 対戦相手を選んだとき: コースと時間帯・天気を、まずライバルの得意なものにしておく（後の画面で変えられる） */
  const draftRivalDefaults = () => {
    const r = draftRival();
    draft.map = r.course;
    const cond = r.conditions ?? draftBaseEnv;
    draft.time = cond.time;
    draft.weather = cond.weather;
    draft.opponentLights = defaultOpponentLights(draft);
  };
  const applyDraft = (mode: RaceMode | 'free') => c.apply(mode, { ...draft });

  /** note: 説明の下に添える一言（部屋の全員が移動する、など） */
  const courseScreen = (raceOnly: boolean, home?: string, note?: string): MenuScreen => ({
    title: 'コース',
    en: 'COURSE',
    groups: [
      {
        choices: () => {
          const maps = MAPS.filter((m) => !raceOnly || m.race);
          // ライバルの得意なコースを先頭に
          if (home) maps.sort((a, b) => Number(b.id === home) - Number(a.id === home));
          return maps.map((m) => {
            const p = courseProfile(m);
            return {
              id: m.id,
              label: m.name,
              badge: m.id === home ? '得意' : undefined,
              note: p.kind === 'free' ? '自由に走る' : `${(p.length / 1000).toFixed(1)}km・${p.kind === 'loop' ? `周回 ${p.laps}周` : p.kind === 'roundtrip' ? '往復' : '一本道'}`,
            };
          });
        },
        selected: () => draft.map,
        select: (id) => (draft.map = id),
      },
    ],
    detail: () => {
      if (!home) return courseDetail(draftMap(), carLabel, note ? { note } : undefined);
      const r = draftRival();
      const script = RIVAL_DIALOGUES[r.id];
      // セリフが得意なコースだけのライバルなら、ほかのコースを選んだときに知らせる
      const silent = draftMap().id !== home && script && (script.onlyHomeCourse ?? true);
      return courseDetail(draftMap(), carLabel, {
        badge: draftMap().id === home ? `${r.name}の得意コース` : undefined,
        note: `${silent ? `${r.name}のセリフは、得意コースの「${mapLabel(home)}」でのバトルだけ出ます。` : ''}先行後追いは、周回コースでも1周で1本です`,
      });
    },
  });
  const carScreen: MenuScreen = {
    title: '自分の車',
    en: 'MACHINE',
    groups: [
      {
        choices: () => VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, note: `${driveOf(v) ?? ''}${driveOf(v) ? '・' : ''}最高 ${Math.round(topSpeedOf(v.params) * 3.6)}km/h` })),
        selected: () => draft.car,
        select: (id) => (draft.car = id),
      },
    ],
    detail: () => carDetail(draftCar(), carPreview),
  };
  const npcScreen: MenuScreen = {
    title: 'NPCの強さ',
    en: 'OPPONENTS',
    groups: [
      {
        choices: () => NPC_LEVELS.map((l) => ({ id: l.id, label: l.label })),
        selected: () => draft.npc,
        select: (id) => (draft.npc = id),
      },
    ],
    detail: () => npcDetail(draftNpc(), NPC_COUNT),
  };
  const rivalScreen: MenuScreen = {
    title: '対戦相手',
    en: 'RIVAL',
    groups: [
      {
        choices: () => {
          const beaten = loadBeatenRivals();
          return RIVALS.map((r) => ({
            id: r.id,
            label: r.name,
            badge: beaten.has(r.id) ? 'WIN' : undefined,
            note: `${carLabel(r.car)}・${rivalLevel(r).label}`,
          }));
        },
        selected: () => draft.rival,
        select: (id) => {
          draft.rival = id;
          draftRivalDefaults();
        },
      },
    ],
    detail: () => {
      const r = draftRival();
      return rivalDetail(r, rivalLevel(r), { car: carLabel(r.car), course: [mapLabel(r.course), rivalConditionsLabel(r)].filter(Boolean).join('・'), beaten: loadBeatenRivals().has(r.id) }, carPreview);
    },
  };
  const ruleGroup: MenuGroup = {
    title: 'ルール',
    choices: () => BATTLE_RULES,
    selected: () => draft.rule,
    select: (id) => (draft.rule = id as BattleRule),
  };
  /** ラフプレー（できるライバルのときだけ出す） */
  const roughGroup: MenuGroup = {
    title: 'ラフプレー',
    choices: () => [
      { id: 'off', label: 'なし' },
      { id: 'on', label: 'あり', note: draftRival().roughNote ?? 'ぶつけてくる' },
    ],
    selected: () => (draft.rough ? 'on' : 'off'),
    select: (id) => (draft.rough = id === 'on'),
  };
  const ruleScreen: MenuScreen = {
    title: 'ルール',
    en: 'RULE',
    get groups() {
      return draftRival().rough ? [ruleGroup, roughGroup] : [ruleGroup];
    },
    detail: () => {
      const rule = BATTLE_RULES.find((r) => r.id === draft.rule)!;
      const r = draftRival();
      const rough = r.rough
        ? [
            draft.rough
              ? `ラフプレーあり: ${r.name}は${r.roughHow ?? 'コーナーの手前で並びかけ、ぶつけてコースの外へ押し出そうとしてくる。並ばれたら気をつけて'}。`
              : `ラフプレーなし（「あり」にすると、${r.name}が${r.roughNote ?? 'ぶつけてくる'}）。`,
          ]
        : [];
      return textDetail({
        kicker: `VS ${r.name}`,
        title: rule.label,
        big: draft.rule === 'side' ? '1:1' : 'SD',
        lines: [
          ...(draft.rule === 'side'
            ? ['2台が横に並んでスタートし、先にゴールしたほうの勝ち。']
            : [
                `先行と後追いに分かれて1本ずつ走り、ゴールの時点で判定する（サドンデス）。`,
                `後追いが抜いて先にゴールすれば後追いの勝ち。後追いが先行から ${SAFE_SECONDS}秒より遅れてゴールすれば先行の勝ち。`,
                `${SAFE_SECONDS}秒以内に続いてゴールすれば引き分けで、先行と後追いを入れ替えて次の1本へ。`,
              ]),
          ...rough,
        ],
      });
    },
  };
  const timeGroup: MenuGroup = {
    title: '時間帯',
    choices: () => TIMES_OF_DAY,
    selected: () => draft.time,
    select: (id) => {
      draft.time = id as TimeOfDay;
      draft.opponentLights = defaultOpponentLights(draft);
    },
  };
  const weatherGroup: MenuGroup = {
    title: '天気',
    choices: () => WEATHERS,
    selected: () => draft.weather,
    select: (id) => {
      draft.weather = id as Weather;
      draft.opponentLights = defaultOpponentLights(draft);
    },
  };
  /** 相手（NPC・ライバル）がライトをつけて走るか。時間帯・天気を選ぶと、それに合わせた方に戻る */
  const opponentLightsGroup: MenuGroup = {
    title: '相手のライト',
    choices: () => [
      { id: 'on', label: 'つける' },
      { id: 'off', label: '消す', note: draft.time === 'night' ? '暗い中で見えにくい' : undefined },
    ],
    selected: () => (draft.opponentLights ? 'on' : 'off'),
    select: (id) => (draft.opponentLights = id === 'on'),
  };
  /** 時間帯・天気の画面。withOpponents なら、相手のライトも選べる */
  const conditionsScreen = (withOpponents: boolean): MenuScreen => ({
    title: '時間帯・天気',
    en: 'CONDITIONS',
    groups: withOpponents ? [timeGroup, weatherGroup, opponentLightsGroup] : [timeGroup, weatherGroup],
    detail: () =>
      conditionsDetail(TIMES_OF_DAY.find((t) => t.id === draft.time)!, WEATHERS.find((w) => w.id === draft.weather)!, [
        ['コース', draftMap().name],
        ['車', draftCar().label],
        ...(withOpponents ? [['相手のライト', draft.opponentLights ? 'つける' : '消す'] as [string, string]] : []),
      ]),
  });
  const envScreen = conditionsScreen(false);
  const opponentEnvScreen = conditionsScreen(true);
  const envSummary = () => `${timeLabel(draft.time)}・${weatherLabel(draft.weather)}`;
  const menuModes: MenuMode[] = [
    {
      id: 'free',
      label: '自由に走る',
      en: 'FREE RUN',
      note: '好きなマップを自由にドライブ',
      detail: modeDetail('自由に走る', 'FREE RUN', ['街・峠・サーキット・首都高を、時間を気にせず走る。', 'オンラインの部屋に入れば、友だちと同じマップを走れます。']),
      begin: () => beginDraft(false),
      screens: () => [courseScreen(false), carScreen, envScreen],
      summary: () => `${draftMap().name} ／ ${draftCar().label} ／ ${envSummary()}`,
      finish: () => applyDraft('free'),
    },
    {
      id: 'timeAttack',
      label: 'タイムアタック',
      en: 'TIME ATTACK',
      note: '自己ベストとゴーストに挑戦',
      detail: modeDetail('タイムアタック', 'TIME ATTACK', ['アクセルを踏むとカウントダウン。自己ベストの走りがゴーストになって一緒に走る。', 'ゴールすると記録はランキングにも送られます。']),
      begin: () => beginDraft(true),
      screens: () => [courseScreen(true), carScreen, envScreen],
      summary: () => `${draftMap().name} ／ ${draftCar().label} ／ ${envSummary()}`,
      finish: () => applyDraft('timeAttack'),
    },
    {
      id: 'npc',
      label: 'NPCと対戦',
      en: 'RACE',
      note: `${NPC_COUNT}台のNPCとレース`,
      detail: modeDetail('NPCと対戦', 'RACE', [`${NPC_COUNT}台のNPCが前に並び、最後尾からスタートして順位を競う。`, '強さは5段階から選べます。']),
      begin: () => beginDraft(true),
      screens: () => [courseScreen(true), npcScreen, carScreen, opponentEnvScreen],
      summary: () => `${draftMap().name} ／ NPC ${draftNpc().label} ／ ${draftCar().label} ／ ${envSummary()}`,
      finish: () => applyDraft('npc'),
    },
    {
      id: 'battle',
      label: 'ライバルとバトル',
      en: 'BATTLE',
      note: '1対1。先行後追いも選べる',
      detail: modeDetail('ライバルとバトル', 'BATTLE', [`${RIVALS.length}人のライバルと1対1。横に並んでのスタートか、先行後追いのサドンデスで勝負する。`, `勝った相手: ${loadBeatenRivals().size} / ${RIVALS.length}`]),
      begin: () => {
        beginDraft(true);
        draftRivalDefaults();
      },
      screens: () => [rivalScreen, ruleScreen, courseScreen(true, draftRival().course), carScreen, opponentEnvScreen],
      summary: () => `VS ${draftRival().name} ／ ${BATTLE_RULES.find((r) => r.id === draft.rule)!.label}${draft.rough && draftRival().rough ? '・ラフプレー' : ''} ／ ${draftMap().name} ／ ${draftCar().label}`,
      finish: () => applyDraft('battle'),
    },
  ];
  /**
   * いまのレースのモードのまま、選ぶ画面をもう一度たどって選び直す（ポーズ画面・ゴールの画面から）。
   * 最初はいまの相手・ルール・コース・車・時間帯・天気が選ばれていて、変えたいところだけ変えればよい
   */
  function openChangeFlow() {
    const base = menuModes.find((m) => m.id === c.raceMode());
    if (!base) return;
    // ライバルとバトルでも、相手の得意コースに戻さず、いまのコースから始める
    menu.openFlow({ ...base, label: 'コース・車などを変える', en: 'CHANGE', begin: () => beginDraft(true) });
  }
  const openSettings = { label: () => '設定', en: 'OPTIONS', run: () => menu.openSettings(), detail: settingDetail('設定', ['カメラ・サウンド・ハンドルなど。']) };
  /** オンラインの部屋に入る画面を開く（入った後はその部屋のコースをそのまま走る。対戦はメニューから） */
  const openJoin = () => {
    menu.close();
    online.openJoin('友だちと同じ部屋コードを入れて「参加する」。入った後は、メニューの「対戦のエントリーを始める」で部屋のみんなとレースできます。');
  };
  const onlineItem: MenuItem = {
    label: () => 'オンライン',
    en: 'ONLINE',
    note: () => (online.isOnline() ? `部屋 ${online.roomCode()} に参加中` : '部屋のみんなと走る・対戦する'),
    major: true,
    run: () => {
      if (!online.isOnline()) return openJoin();
      menu.close();
      if (online.roomRace()?.phase === 'entry') online.openEntry();
    },
    detail: modeDetail('オンライン', 'ONLINE', [
      '同じ部屋コードを入れた人と、同じコースを一緒に走れます（最大8人）。',
      '部屋に入ったら、メニュー（Esc・☰）の「対戦のエントリーを始める」でコースと時間帯・天気を決めて、部屋のみんなとレースできます。',
      'メニューの「コース・車などを変える」でコースを変えると、部屋の全員が同じコースに移動します。',
    ]),
  };
  /** 自由に走っている間に、コースと車などを選び直す（メニューから。部屋にいれば全員が移動する） */
  const freeChangeMode: MenuMode = {
    id: 'freeChange',
    label: 'コース・車などを変える',
    en: 'CHANGE',
    note: 'コース・車・時間帯と天気を選び直す',
    detail: modeDetail('コース・車などを変える', 'CHANGE', ['いまのまま自由に走りながら、コース・車・時間帯・天気を選び直す。']),
    begin: () => beginDraft(false),
    screens: () => [courseScreen(false, undefined, online.isOnline() ? '選んだコースに、部屋の全員が一緒に移動します。' : undefined), carScreen, envScreen],
    summary: () => `${draftMap().name} ／ ${draftCar().label} ／ ${envSummary()}`,
    finish: () => applyDraft('free'),
    finishLabel: '走る',
  };
  /** オンライン対戦を言い出す: コースと時間帯・天気を決める（車は各自がエントリー画面で選ぶ） */
  const onlineRaceMode: MenuMode = {
    id: 'onlineRace',
    label: '対戦のエントリー',
    en: 'ENTRY',
    note: '部屋のみんなとレース',
    detail: modeDetail('対戦のエントリー', 'ONLINE ENTRY', ['コースと時間帯・天気を決めると、部屋の全員にエントリー画面が開きます。', '各自が車を選んで準備OKにしたら、スタートで一斉にカウントダウン。']),
    begin: () => beginDraft(true),
    screens: () => [courseScreen(true), envScreen],
    summary: () => `${draftMap().name} ／ ${envSummary()}`,
    finish: () => {
      // 選んでいる間に、他の人がエントリーを始めていた・部屋から抜けていた
      if (!online.isOnline()) return c.toast('部屋から抜けたので、エントリーを始められませんでした');
      const roomRace = online.roomRace();
      if (roomRace && roomRace.host !== online.selfId()) return openRaceEntry();
      online.openRace({ map: MAPS.findIndex((m) => m.id === draft.map), time: draft.time, weather: draft.weather });
    },
    finishLabel: 'エントリー開始',
  };
  /** オンライン対戦のエントリーを始める（コースと時間帯・天気を選ぶ画面へ） */
  const openRaceEntry = () => {
    const roomRace = online.roomRace();
    if (roomRace?.phase === 'entry') {
      menu.close();
      online.openEntry();
    } else if (roomRace) c.toast('いまは対戦の最中です。終わったら始められます');
    else menu.openFlow(onlineRaceMode);
  };
  const inOnlineRace = () => c.race() !== null && c.raceMode() === 'online';
  const raceEntryItems: MenuItem[] = [
    {
      label: () => '対戦のエントリーを始める',
      en: 'ENTRY',
      run: openRaceEntry,
      visible: () => online.isOnline() && !online.roomRace() && !inOnlineRace(),
      detail: () =>
        settingDetail('対戦のエントリーを始める', [
          `部屋 ${online.roomCode()} のみんなとレースする。コースと時間帯・天気を決めると、あなたが主催になって全員にエントリー画面が開きます。`,
          '各自が車を選んで準備OK（または今回は見送る）にしたら、主催の「スタート」で一斉にカウントダウン。',
          '先に誰かがエントリーを始めていたら、その対戦に参加します（同時に始めても、主催は1人だけです）。',
        ])(),
    },
    {
      label: () => 'エントリー画面',
      en: 'ENTRY',
      run: openRaceEntry,
      visible: () => online.roomRace()?.phase === 'entry',
      detail: () => {
        const roomRace = online.roomRace();
        return settingDetail('エントリー画面', [
          roomRace && roomRace.host === online.selfId() ? 'あなたが主催の対戦のエントリー画面を開く。' : `${online.nameOf(roomRace?.host ?? 0)} さんが始めた対戦のエントリー画面を開く。途中から部屋に来ても参加できます。`,
          '車を選んで準備OKにするか、今回は見送るかを選べます。',
        ])();
      },
    },
    {
      label: () => '部屋に入る',
      en: 'JOIN ROOM',
      run: openJoin,
      visible: () => online.available && !online.isOnline() && c.race() === null,
      detail: () =>
        settingDetail('部屋に入る', [
          '部屋コードを入れて、オンラインの部屋に入る。前に入った部屋のコードが入った状態で開きます。',
          '入った後は、部屋のいまのコースをそのまま走れます。',
        ])(),
    },
  ];
  const rankingItem: MenuItem = {
    label: () => 'ランキング',
    en: 'RANKING',
    run: () => {
      menu.close();
      c.openRanking();
    },
    visible: () => c.hasRanking,
    detail: settingDetail('ランキング', ['タイムアタックの記録の一覧。上位の人のゴーストと対戦できます。']),
  };
  const nowInfo = () => {
    const now = c.current();
    return `${c.level().def.name} ／ ${c.race() ? c.raceLabel() : '自分で運転'} ／ ${carLabel(now.car)} ／ ${timeLabel(now.time)}・${weatherLabel(now.weather)}`;
  };
  /** ポーズ画面の右側: いま走っているコースの地図 */
  const pauseDetail = () => courseDetail(c.level().def, carLabel, { badge: c.race() ? c.raceLabel() : '自由に走る' });
  const menu: GameMenu = new GameMenu(
    menuModes,
    {
      home: [onlineItem, rankingItem, openSettings],
      pause: [
        {
          label: () => (inOnlineRace() ? 'コースに戻る' : 'やり直す'),
          en: 'RETRY',
          run: () => {
            menu.close();
            if (c.race() && c.raceMode() !== 'online') c.startRace(c.raceMode());
            else c.resetCar();
          },
          detail: pauseDetail,
        },
        {
          label: () => 'コース・車などを変える',
          en: 'CHANGE',
          run: () => (c.race() ? openChangeFlow() : menu.openFlow(freeChangeMode)),
          // オンライン対戦（エントリー中を含む）の間は、部屋のコースのまま
          visible: () => (c.race() ? c.raceMode() !== 'online' : !online.roomRace()),
          detail: () => {
            const race = c.race();
            const mode = c.raceMode();
            return settingDetail('コース・車などを変える', [
              race
                ? `同じモードのまま、${mode === 'battle' ? '対戦相手・ルール・' : mode === 'npc' ? 'NPCの強さ・' : ''}コース・車・時間帯・天気を選び直してスタートからやり直す。`
                : 'いまのまま自由に走りながら、コース・車・時間帯・天気を選び直す。',
              'いまの内容が選ばれた状態で始まるので、変えたいところだけ変えて進めます。',
              ...(!race && online.isOnline() ? ['部屋に入っているので、コースを変えると部屋の全員が同じコースに移動します。'] : []),
            ])();
          },
        },
        {
          label: () => (c.raceMode() === 'online' ? '対戦から抜ける' : 'レースをやめる'),
          en: 'QUIT RACE',
          run: () => {
            menu.close();
            c.stopRace();
          },
          visible: () => c.race() !== null,
          detail: pauseDetail,
        },
        ...raceEntryItems,
        {
          label: () => '部屋から抜ける',
          en: 'LEAVE ROOM',
          run: () => {
            menu.close();
            online.leaveRoom();
          },
          visible: () => online.isOnline(),
          detail: () =>
            settingDetail('部屋から抜ける', [`部屋 ${online.roomCode()} から退出して、ひとりで走る。`, inOnlineRace() ? '走っている対戦も途中でやめます。' : 'このメニューの「部屋に入る」から、また入れます。'])(),
        },
        { label: () => 'タイトルに戻る', en: 'TITLE', run: () => menu.openTitle(), detail: settingDetail('タイトルに戻る', ['最初のタイトル画面に戻る。何か押すと、プレイモード・コースを選び直せます。']) },
        { ...rankingItem, visible: () => c.hasRanking && c.race() !== null && c.raceMode() === 'timeAttack' },
        openSettings,
      ],
      settings: c.settings,
    },
    { info: nowInfo, onOpenChange: c.onOpenChange, canOpen: c.canOpen },
  );
  return { menu, openChangeFlow };
}
