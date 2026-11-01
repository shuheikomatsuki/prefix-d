import { SoundSystem } from './audio/sound';
import { BGM_TRACKS, BgmPlayer } from './audio/bgm';
import { GamepadInput, KeyboardInput, PAD_BUTTON, loadSmoothKeySteer, mergeInputs } from './core/input';
import { FixedStepLoop } from './core/loop';
import { Airborne } from './game/airborne';
import { TIMES_OF_DAY, type TimeOfDay, WEATHERS, type Weather, defaultOpponentLights, loadEnvironment, paramsForWeather, saveEnvironment } from './game/environment';
import { FallRecovery } from './game/fall';
import { Level } from './game/level';
import { clearPlayData } from './game/playData';
import { NpcField, npcEntries, rankEntrants, velocityOf } from './game/npcRace';
import { SectionClock, compareSections, sectionCount, sectionPaths, trackSections } from './race/sections';
import type { SectionReport } from './ui/sectionReport';
import { migrateSaveData } from './game/saveVersion';
import { PLAYER_COLORS, RemoteCars, carStateOf, createLabel } from './game/remoteCars';
import { MAPS, TITLE_MAPS } from './map/maps';
import { NetClient } from './net/client';
import { LeaderboardClient } from './net/leaderboardClient';
import { type RankedGhost, Ranking } from './game/ranking';
import { type GhostPose, GhostRecorder, ghostPoseAt } from './race/ghost';
import { NPC_LEVELS } from './race/npcDriver';
import { RIVALS, markRivalBeaten, rivalLevel } from './race/rivals';
import type { BattleContext } from './race/dialogue';
import { BattleTalk } from './race/battleTalk';
import { CHARACTERS } from './race/dialogueScript';
import { CHASE_START_GAP, type Runner, SAFE_SECONDS, SuddenDeath } from './race/suddenDeath';
import { type RaceRecord, loadRecord, mergeRecord, saveRecord } from './race/records';
import { courseKey } from './map/courseRevision';
import { TimeAttack, formatTime } from './race/timeAttack';
import { type RaceSettings, type RaceState, MAX_PLAYERS, MAX_EMOTE_LENGTH, isRoomCode, normalizeRoomCode } from './net/protocol';
import { DEFAULT_EMOTE, loadEmote, saveEmote } from './game/emotes';
import { attachBubble } from './render/bubble';
import { lapsDone, rankOnline, standingsWindow } from './race/onlineRace';
import { OnlineRacePanel } from './ui/onlineRacePanel';
import { CameraRig } from './render/camera';
import { CarMesh, carStyle, driverEyeFor } from './render/carMesh';
import { createGhostMesh } from './render/raceMesh';
import { GameScene } from './render/scene';
import { nearestLit } from './game/headlights';
import { Mirrors, loadMirrorMode } from './render/mirrors';
import type { CarSnapshot, Spawn } from './sim/car';
import { loadRapier } from './sim/physics';
import { NEUTRAL_INPUT, VEHICLE_PRESETS, topSpeedOf } from './sim/vehicle';
import { Hud, hideLoading, showError } from './ui/hud';
import { OnlinePanel, loadPlayerName } from './ui/onlinePanel';
import { ConfirmDialog } from './ui/confirmDialog';
import { Minimap, type MinimapMarker } from './ui/minimap';
import { createGameMenu } from './ui/menuFlows';
import { settingItems } from './ui/settingsItems';
import { driveOf } from './ui/carStats';
import { RaceHud } from './ui/raceHud';
import { EmoteFeed } from './ui/emoteFeed';
import { hex } from './ui/html';
import { measureMirrorRegion } from './ui/mirrorLayout';
import { netStatusHtml } from './ui/netStatus';
import { Horns } from './game/horn';
import { NPC_COUNT, type RaceMode, type BattleRule } from './game/modes';
import { lerpSnapshot } from './sim/interpolate';
import { TouchControls, prefersTouch } from './ui/touchControls';
import { type Speaker, Subtitles } from './ui/subtitles';

/** この強さ [m/s] 以上の速度変化を「衝突」として音・揺れを出す */
const IMPACT_THRESHOLD = 2.5;
/** 段差から着地したときに、この下向きの速さ [m/s] 以上なら音・揺れを出す */
const LANDING_THRESHOLD = 3;
/** 自分の車の状態を送る間隔（物理ステップ数。60Hz / 3 = 20Hz） */
const SEND_EVERY_STEPS = 3;

/** 引き分けのあと、次の1本を始めるまでの時間 [ms] */
const NEXT_ROUND_DELAY = 3500;
/** 近道をしてから、コースを外れた所へ戻すまでの時間 [s] */
const REJOIN_DELAY = 1.2;
/** エモートを続けて送れる間隔 [ms] */
const EMOTE_COOLDOWN_MS = 1500;

async function main() {
  // 古い版のゲームで保存したデータを、いまの版の形に直してから読み込む
  migrateSaveData();
  const rapier = await loadRapier();
  const params = new URLSearchParams(location.search);
  // オンライン用のサーバー（みんなで走る・ランキング）
  const serverUrl: string = params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? '';

  const view = new GameScene(document.getElementById('app')!);
  const cameraRig = new CameraRig(window.innerWidth / window.innerHeight);
  const hud = new Hud();
  const sound = new SoundSystem();
  const bgm = new BgmPlayer(BGM_TRACKS);
  window.addEventListener('resize', () => view.resize(cameraRig.camera));
  /** バックミラー・サイドミラー */
  const mirrors = new Mirrors(document.body, loadMirrorMode());
  /** ミラーを置ける範囲（画面のいちばん上の真ん中。毎フレーム測ると重いので時々） */
  let mirrorRegion = { left: 0, right: window.innerWidth, top: 8 };
  let mirrorRegionAge = 0;
  // ?map=1 のように開始マップを指定できる
  const requested = Number(params.get('map'));
  // 指定がなければ、タイトル画面の後ろに映す峠・首都高のどれかから始める（毎回変わる）
  const titleMap = TITLE_MAPS[Math.floor(Math.random() * TITLE_MAPS.length)];
  let mapIndex = params.has('map') && Number.isInteger(requested) && requested >= 0 && requested < MAPS.length ? requested : MAPS.indexOf(titleMap);
  // ?car=fd3s のように開始時の車を指定できる
  let carIndex = Math.max(0, VEHICLE_PRESETS.findIndex((v) => v.id === params.get('car')));
  const vehicle = () => VEHICLE_PRESETS[carIndex];
  // 時間帯と天気（?time=night&weather=rain のように指定もできる）
  const env = loadEnvironment();
  const timeParam = TIMES_OF_DAY.find((t) => t.id === params.get('time'));
  const weatherParam = WEATHERS.find((w) => w.id === params.get('weather'));
  if (timeParam) env.time = timeParam.id;
  if (weatherParam) env.weather = weatherParam.id;
  view.setEnvironment(env);
  /** いまの天気での自分の車の性能（雨は滑りやすい） */
  const carParams = () => paramsForWeather(vehicle().params, env.weather);
  /** オンラインの部屋で割り当てられた色（一人のときは車ごとの色） */
  let assignedColor: number | null = null;
  let carMesh = new CarMesh(undefined, carStyle(vehicle().id));
  view.scene.add(carMesh.root);
  cameraRig.setCarScale(carStyle(vehicle().id).scale ?? 1);
  cameraRig.setDriverEye(driverEyeFor(carStyle(vehicle().id)));
  /** 車を替えたら、その車の形の車体に作り直す */
  const rebuildCarMesh = () => {
    carMesh.dispose();
    carMesh = new CarMesh(assignedColor ?? undefined, carStyle(vehicle().id));
    carMesh.setLights(lightsOn);
    view.scene.add(carMesh.root);
    cameraRig.setCarScale(carStyle(vehicle().id).scale ?? 1);
    cameraRig.setDriverEye(driverEyeFor(carStyle(vehicle().id)));
  };
  /** ヘッドライト（暗い時間帯・天気では最初からつける。F キー・ボタンで切り替え） */
  let lightsOn = GameScene.needsHeadlights(env);
  /** NPC・ライバルがライトをつけて走るか（時間帯・天気の画面で選ぶ。最初は時間帯・天気に合わせる） */
  let opponentLights = defaultOpponentLights(env);
  const npcLightsOn = () => opponentLights;
  const applyLights = () => {
    carMesh.setLights(lightsOn);
    view.setHeadlights(lightsOn);
  };
  applyLights();
  let level = new Level(rapier, MAPS[mapIndex]);
  level.car.params = carParams();
  view.scene.add(level.group);
  let prev = level.car.snapshot();
  let curr = prev;
  let input = { ...NEUTRAL_INPUT };
  /** 峠で道路から落ちたとき */
  const fall = new FallRecovery();
  /** 段差で宙に浮いたとき */
  const air = new Airborne();
  const groundAt = (s: CarSnapshot) => level.heightAt(s.x, s.z, s.courseS, s.yaw);

  const remoteCars = new RemoteCars(view.scene);
  remoteCars.attachLevel(level);

  // --- タイムアタック・NPC 対戦 ---
  let race: TimeAttack | null = null;
  /** いま走っているレースの種類 */
  let raceMode: RaceMode = 'timeAttack';
  /** ライバルとのバトルの相手（RIVALS の番号） */
  let battleIndex = 0;
  const battleRival = () => RIVALS[battleIndex];

  // --- バトルのセリフ ---
  const speakerOf = (who: string): Speaker => {
    if (who === 'player') return { name: loadPlayerName().trim() || 'あなた', isPlayer: true };
    if (who === 'sfx') return { name: '', isEffect: true };
    const r = RIVALS.find((x) => x.id === who);
    if (r) return { name: r.name, photo: r.photo };
    return CHARACTERS[who] ?? { name: who };
  };
  const subtitles = new Subtitles(speakerOf, (name) => sound.effect(name));
  const talk = new BattleTalk(subtitles);
  let lastImpact = 0;
  const debugWhere = params.has('debug') ? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'debug-where' })) : null;
  /** バトルのルール */
  let battleRule: BattleRule = 'side';
  /** 横に並ぶバトルで、自分とライバルが区間の区切りを通った時刻（結果で、どこで離されたかを見せる） */
  let sections: { me: SectionClock; them: SectionClock; paths: { x: number; z: number }[][] } | null = null;
  /** ライバルにラフプレーをさせるか（できるライバルだけ） */
  let battleRough = false;
  const roughOn = () => battleRough && !!battleRival().rough;
  /** 先行後追いのバトルの進行（それ以外のレースでは null） */
  let suddenDeath: SuddenDeath | null = null;
  let nextRoundTimer: number | undefined;
  /** NPC 対戦の NPC たち */
  let npcField: NpcField | null = null;
  /** NPC の強さ（?npc=pro のように指定できる） */
  let npcLevelIndex = Math.max(0, NPC_LEVELS.findIndex((l) => l.id === (params.get('npc') ?? 'hard')));
  let ghostRecorder = new GhostRecorder();
  /** いまのコースと車での自己ベスト */
  let best: RaceRecord | null = null;
  const ghostMesh = createGhostMesh();
  ghostMesh.root.visible = false;
  view.scene.add(ghostMesh.root);
  /** ランキングから選んだ人のゴースト（オレンジ色で一緒に走る） */
  let rival: RankedGhost | null = null;
  const rivalMesh = createGhostMesh(0xffa040);
  rivalMesh.root.visible = false;
  view.scene.add(rivalMesh.root);
  let rivalLabel: ReturnType<typeof createLabel> | null = null;
  const setRival = (r: typeof rival) => {
    rival = r;
    if (rivalLabel) {
      rivalMesh.root.remove(rivalLabel);
      rivalLabel.material.map?.dispose();
      rivalLabel.material.dispose();
      rivalLabel = null;
    }
    if (r) {
      rivalLabel = createLabel(r.name);
      rivalMesh.root.add(rivalLabel);
    }
    rivalMesh.root.visible = false;
  };
  /** ゴーストの位置を、描画用の車の状態にする */
  /** ゴーストのコース上の距離（立体交差のどちらの道を走っているかを、前の位置から追う） */
  const ghostCourseS = { best: null as number | null, rival: null as number | null };
  const ghostSnapshot = (p: GhostPose, which: keyof typeof ghostCourseS): CarSnapshot => {
    const courseS = level.locate(p.x, p.z, p.yaw, ghostCourseS[which]);
    ghostCourseS[which] = courseS;
    return level.ground({ x: p.x, y: 0.05, z: p.z, yaw: p.yaw, forwardSpeed: 0, lateralSpeed: 0, steerAngle: 0, wheelSpin: 0, ...(courseS !== null ? { courseS } : {}) });
  };
  const raceMapIndex = MAPS.findIndex((m) => m.race);
  const minimap = new Minimap(document.getElementById('minimap')!, (h) => document.body.style.setProperty('--minimap-h', `${h}px`));
  /** 俯瞰の地図はどのモードでも出す（レースでなくても、いまのマップの道を描く） */
  const showMinimap = () => minimap.setMap(level.def, level.course);
  const raceHud = new RaceHud({
    onRetry: () => race && startRace(raceMode),
    onQuit: () => stopRace(),
    onRanking: () => openRanking(),
    onChange: () => openChangeFlow(),
  });

  const placeCar = (spawn: Spawn) => {
    level.car.reset(spawn);
    fall.cancel();
    prev = curr = level.car.snapshot();
    air.reset(groundAt(curr));
    cameraRig.snap();
    // スタート地点で他の車と重なっても弾き飛ばされないように
    remoteCars.ghost(performance.now());
  };
  const resetCar = () => {
    // オンライン対戦では、いまいる所のコースの真ん中に戻す（みんなと走っているのでやり直せない）
    if (race && raceMode === 'online') recoverOnCourse();
    // レース中のリセットは、スタートからやり直し
    else if (race) startRace(raceMode);
    else placeCar(level.spawn);
  };
  function recoverOnCourse() {
    const course = level.course;
    if (!course || !race) return;
    if (race.phase === 'ready' || race.phase === 'countdown') {
      placeCar(onlineGridSpot());
      return;
    }
    const s = course.project(curr.x, curr.z).s;
    const p = course.pointAt(Math.max(0, s));
    placeCar({ x: p.x, z: p.z, yaw: p.yaw, s: Math.max(0, s) });
  }

  const raceLabel = () =>
    raceMode === 'online'
      ? 'オンライン対戦'
      : raceMode === 'npc'
      ? `NPC対戦（${NPC_LEVELS[npcLevelIndex].label}）`
      : raceMode === 'battle'
        ? `バトル（${battleRival().name}${battleRule === 'side' ? '' : '・先行後追い'}${roughOn() ? '・ラフプレー' : ''}）`
        : 'タイムアタック';

  /**
   * レース用のコースのスタートラインの手前に並び、カウントダウンから始める。
   * いまのマップがレース用でなければサーキットへ移動する。NPC 対戦では NPC が前に並び、自分は最後尾から。
   * ライバルとのバトルは、ライバルと横に並ぶ。toHome ならライバルの得意なコースへ移動する（他のコースでもバトルできる）
   */
  function startRace(mode: RaceMode, toHome = false, nextRound = false) {
    if (mode === 'online') return;
    if (race && raceMode === 'online') leaveOnlineRace();
    raceMode = mode;
    window.clearTimeout(nextRoundTimer);
    // 先行後追いは、引き分けで次の1本へ進むときだけ続きから。それ以外は1本目から
    suddenDeath = mode === 'battle' && battleRule !== 'side' ? (nextRound && suddenDeath ? suddenDeath : new SuddenDeath(battleRule === 'leadFirst')) : null;
    if (mode !== 'timeAttack') setRival(null);
    let target = mode === 'battle' && toHome ? MAPS.findIndex((m) => m.id === battleRival().course) : level.course ? mapIndex : raceMapIndex;
    // オンライン対戦のエントリー中は、部屋のコースのまま
    if (target !== mapIndex && roomRace && level.course) target = mapIndex;
    if (target !== mapIndex) {
      // 前のレースを片付けてから移動する（移動先でこの後並び直す）
      race = null;
      npcField?.dispose();
      npcField = null;
      loadMap(target);
      // 同じ部屋の全員も同じコースへ
      net.send({ t: 'map', map: mapIndex });
    }
    npcField?.dispose();
    npcField = null;
    const course = level.course!;
    // 先行後追いは周回コースでも1周で1本
    const laps = suddenDeath ? 1 : level.def.race!.laps;
    // アクセルを踏むまでカウントダウンを始めない（自分のタイミングでスタートする）
    race = new TimeAttack(course, laps, true);
    const count = sectionCount(course.length);
    sections = mode === 'battle' && !suddenDeath ? { me: new SectionClock(course.length, count, laps), them: new SectionClock(course.length, count, laps), paths: sectionPaths(course, count) } : null;
    ghostRecorder = new GhostRecorder();
    ghostCourseS.best = ghostCourseS.rival = 0;
    // NPC 対戦ではゴーストを出さず、記録も残さない
    best = mode === 'timeAttack' ? loadRecord(courseKey(level.def), vehicle().id) : null;
    // 2列に互い違いに並ぶ。道幅に合わせて左右の間隔を決める
    const side = Math.min(3, course.widthAt(0) / 4);
    const slot = (i: number) => course.gridSpot(6 + 7 * i, i % 2 === 0 ? side : -side);
    if (mode === 'npc') {
      const grid = Array.from({ length: NPC_COUNT }, (_, i) => slot(i));
      npcField = new NpcField(level, view.scene, npcEntries(NPC_COUNT, NPC_LEVELS[npcLevelIndex], carParams(), carStyle(vehicle().id)), laps, grid);
      placeCar(slot(NPC_COUNT));
    } else if (mode === 'battle') {
      const r = battleRival();
      const preset = VEHICLE_PRESETS.find((v) => v.id === r.car) ?? VEHICLE_PRESETS[0];
      const style = carStyle(preset.id);
      const entry = { name: r.name, color: style.color, level: rivalLevel(r), params: paramsForWeather(preset.params, env.weather), style, variation: 1, rough: roughOn() ? r.rough : null };
      if (suddenDeath) {
        // 先行が前、後追いはその後ろに同じ列で並ぶ
        const lead = course.gridSpot(6);
        const chase = course.gridSpot(6 + CHASE_START_GAP);
        npcField = new NpcField(level, view.scene, [entry], laps, [suddenDeath.playerLeads ? chase : lead]);
        placeCar(suddenDeath.playerLeads ? lead : chase);
      } else {
        npcField = new NpcField(level, view.scene, [entry], laps, [course.gridSpot(6, side)]);
        placeCar(course.gridSpot(6, -side));
      }
    } else {
      placeCar(course.gridSpot(6));
    }
    npcField?.setLights(npcLightsOn());
    raceHud.show(true);
    const go = touch.isShown ? 'アクセルを押すとスタート' : 'アクセル（W / ↑）でスタート';
    raceHud.showReady(suddenDeath ? `${suddenDeath.round}本目・あなたが${suddenDeath.playerLeads ? '先行' : '後追い'}　${go}` : go);
    showMinimap();
    raceHud.hideResult();
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    hud.setMode(raceLabel());
    touch.refresh();
    menu.refresh();
    startTalk(mode, nextRound);
  }

  /** バトルのセリフを用意し、スタート前の場面を出す（先行後追いの2本目からは、round を書いた場面だけ） */
  function startTalk(mode: RaceMode, nextRound: boolean) {
    const r = battleRival();
    const ctx: BattleContext | null =
      mode === 'battle'
        ? {
            course: level.def.id,
            homeCourse: r.course,
            playerCar: vehicle().id,
            rule: suddenDeath ? 'suddenDeath' : 'side',
            playerLeads: suddenDeath?.playerLeads ?? false,
            round: suddenDeath?.round ?? 1,
            weather: env.weather,
            time: env.time,
          }
        : null;
    talk.start(mode === 'battle' ? r.id : null, ctx, nextRound);
  }

  /** スタートの合図: カウントダウンを始める */
  function beginRace() {
    if (!race || race.phase !== 'ready' || subtitles.sceneActive) return;
    race.begin();
    npcField?.begin();
  }

  /** レースの表示と NPC を片付ける（車の位置はそのまま） */
  function clearRace() {
    race = null;
    sections = null;
    talk.clear();
    suddenDeath = null;
    window.clearTimeout(nextRoundTimer);
    npcField?.dispose();
    npcField = null;
    raceHud.show(false);
    showMinimap();
    ghostMesh.root.visible = false;
    rivalMesh.root.visible = false;
  }

  function stopRace() {
    if (!race) return;
    if (raceMode === 'online') leaveOnlineRace();
    clearRace();
    setRival(null);
    hud.setMode('自分で運転');
    resetCar();
    touch.refresh();
    menu.refresh();
  }

  const toggleRace = (mode: RaceMode) => (race && raceMode === mode ? stopRace() : startRace(mode, true));
  const cycleNpcLevel = () => {
    npcLevelIndex = (npcLevelIndex + 1) % NPC_LEVELS.length;
    hud.toast(`NPCの強さ: ${NPC_LEVELS[npcLevelIndex].label}`);
    if (race && raceMode === 'npc') startRace('npc');
    touch.refresh();
  };

  /** NPC 対戦の順位（自分を含む） */
  const standings = () => {
    if (!race || !npcField) return [];
    return rankEntrants([
      { name: loadPlayerName().trim() || 'あなた', color: carMesh.color, isPlayer: true, timer: race, x: curr.x, z: curr.z },
      ...npcField.npcs.map((n) => ({ name: n.name, color: n.color, isPlayer: false, timer: n.timer, x: n.curr.x, z: n.curr.z })),
    ]);
  };

  /** バトルの結果に添える区間ごとのタイム差 */
  const sectionReport = (): SectionReport | null => (sections ? { gaps: compareSections(sections.me, sections.them), paths: sections.paths } : null);

  /** ゴールを知らせた NPC（レースが変わったら作り直す） */
  let finishSeen: { race: TimeAttack; timers: Set<TimeAttack> } | null = null;
  /** NPC・ライバルがゴールしたら、まだ走っている自分に知らせる */
  const announceNpcFinishes = (r: TimeAttack) => {
    if (!npcField) return;
    if (finishSeen?.race !== r) finishSeen = { race: r, timers: new Set() };
    const timers = [r, ...npcField.npcs.map((n) => n.timer)];
    for (const n of npcField.npcs) {
      if (n.timer.phase !== 'finished' || finishSeen.timers.has(n.timer)) continue;
      finishSeen.timers.add(n.timer);
      if (r.phase !== 'racing') continue;
      const place = 1 + timers.filter((t) => t !== n.timer && t.phase === 'finished' && t.time < n.timer.time).length;
      raceHud.announceFinish(n.name, n.color, npcField.npcs.length > 1 ? `${place}位　${formatTime(n.timer.time)}` : formatTime(n.timer.time));
    }
  };
  /** 近道をしたとき、コースに戻すレースの時刻（戻すまで少し間をおいて、何が起きたかを見せる） */
  let rejoinAt: { race: TimeAttack; time: number } | null = null;
  const handleRaceEvents = (r: TimeAttack) => {
    if (rejoinAt?.race !== r) rejoinAt = null;
    if (rejoinAt && r.time >= rejoinAt.time) {
      rejoinAt = null;
      const s = r.phase === 'racing' ? r.rejoin() : null;
      const course = level.course;
      if (s !== null && course) {
        const p = course.pointAt(s);
        placeCar({ x: p.x, z: p.z, yaw: p.yaw, s });
      }
    }
    for (const e of r.drainEvents()) {
      switch (e.type) {
        case 'count':
          raceHud.showReady(null);
          raceHud.count(e.value);
          sound.beep(e.value === 0);
          break;
        case 'lap': {
          if (r.phase === 'finished') break;
          const ref = best?.laps[e.lap - 1];
          const diff = ref === undefined ? '' : `（${e.time - ref >= 0 ? '+' : '−'}${Math.abs(e.time - ref).toFixed(2)}）`;
          raceHud.split(`${e.lap}周目 ${formatTime(e.time)}${diff}`, ref !== undefined && e.time < ref);
          sound.beep();
          break;
        }
        case 'finish': {
          // 先行後追いの勝ち負けは judgeSuddenDeath で決める
          if (suddenDeath) break;
          if (raceMode === 'online') {
            if (onlineSeq !== null) net.send({ t: 'raceFinish', seq: onlineSeq, time: e.total });
            raceHud.setWarning({ wrongWay: false, offCourse: false });
            raceHud.showRankingButton(false);
            sound.beep(true);
            break;
          }
          if (raceMode !== 'timeAttack') {
            const list = standings();
            const won = list[0]?.isPlayer ?? false;
            if (raceMode === 'battle' && won) markRivalBeaten(battleRival().id);
            raceHud.setWarning({ wrongWay: false, offCourse: false });
            sound.beep(true);
            const show = () => {
              raceHud.showStandings(standings(), r.totalLaps, raceMode === 'battle', sectionReport());
              raceHud.showRankingButton(false);
            };
            if (raceMode === 'battle') talk.outcome(won ? 'win' : 'lose', show);
            else show();
            break;
          }
          const previousBest = best?.total ?? null;
          const merged = mergeRecord(best, { total: e.total, laps: e.laps, ghost: ghostRecorder.frames });
          const saved = merged.newTotal || merged.newLap ? saveRecord(courseKey(level.def), vehicle().id, merged.record) : true;
          best = merged.record;
          raceHud.showResult({
            total: e.total,
            laps: e.laps,
            previousBest,
            newTotal: merged.newTotal,
            newLap: merged.newLap,
            bestLap: merged.record.bestLap,
            notSaved: !saved,
          });
          raceHud.setWarning({ wrongWay: false, offCourse: false });
          sound.beep(true);
          reportToRanking(merged.newTotal);
          break;
        }
        case 'wrongWay':
          raceHud.setWarning({ wrongWay: e.on });
          break;
        case 'offCourse':
          raceHud.setWarning({ offCourse: e.on });
          // 近道をしたら、コースを外れた所へ戻す（どこまで戻ればよいか迷わないように）
          rejoinAt = e.on ? { race: r, time: r.time + REJOIN_DELAY } : null;
          break;
      }
    }
  };

  /** 先行後追いの1本の走り（自分と、NPC のライバル） */
  const runners = (): { player: Runner; rival: Runner } | null => {
    const npc = npcField?.npcs[0];
    if (!race || !npc) return null;
    return {
      player: { distance: race.distance(curr.x, curr.z), finishTime: race.phase === 'finished' ? race.time : null },
      rival: { distance: npc.timer.distance(npc.curr.x, npc.curr.z), finishTime: npc.timer.phase === 'finished' ? npc.timer.time : null },
    };
  };

  /** 先行後追いの判定。決着がついたら結果を出し、引き分けなら先行と後追いを入れ替えて次の1本へ */
  const judgeSuddenDeath = () => {
    const sd = suddenDeath;
    const r = runners();
    if (!sd || !r || race?.phase === 'ready' || race?.phase === 'countdown') return;
    // ゴールした側の時計は止まるので、まだ走っている側の時計で測る
    const npc = npcField!.npcs[0];
    const outcome = sd.update(r.player, r.rival, Math.max(race!.time, npc.timer.time));
    if (!outcome) return;
    const name = battleRival().name;
    const lead = sd.playerLeads ? 'あなた' : name;
    const chase = sd.playerLeads ? name : 'あなた';
    sound.beep(true);
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    raceHud.showRankingButton(false);
    if (outcome === 'draw') {
      talk.outcome('draw', () => {
        if (suddenDeath !== sd) return;
        raceHud.showBattleResult(
          `${sd.round}本目は引き分け`,
          `${chase}（後追い）が ${SAFE_SECONDS}秒以内に続いてゴールし、抜くこともできませんでした。先行と後追いを入れ替えて、${sd.round + 1}本目へ…`,
        );
        nextRoundTimer = window.setTimeout(() => {
          if (suddenDeath !== sd) return;
          sd.nextRound();
          startRace('battle', false, true);
        }, NEXT_ROUND_DELAY);
      });
      return;
    }
    const why = outcome === 'leadWins' ? `${lead}（先行）が ${SAFE_SECONDS}秒より大きな差をつけてゴールした` : `${chase}（後追い）が抜いて先にゴールした`;
    const won = sd.winner === 'player';
    if (won) markRivalBeaten(battleRival().id);
    talk.outcome(won ? 'win' : 'lose', () => {
      if (suddenDeath !== sd) return;
      raceHud.showBattleResult(won ? `勝利！ ${name} に勝った` : `敗北… ${name} の勝ち`, `${sd.round}本目で決着：${why}`);
    });
  };

  /** 先行後追いの走行中の表示（何本目・先行か後追いか・差） */
  const battleInfo = (): string | undefined => {
    const sd = suddenDeath;
    const r = runners();
    if (!sd || !r) return undefined;
    const gap = Math.max(0, Math.round(sd.gap(r.player, r.rival)));
    return `${sd.round}本目・あなたが${sd.playerLeads ? '先行' : '後追い'}　差 ${gap}m（ゴールで ${SAFE_SECONDS}秒より離れたら先行の勝ち）`;
  };

  const loadMap = (index: number, message = `マップ: ${MAPS[index].name}`) => {
    // NPC の車は古いマップの物理ワールドにいるので先に片付ける（レース中ならこの後で並び直す）
    npcField?.dispose();
    npcField = null;
    // ランキングの人のゴーストは、そのコースでだけ一緒に走る
    setRival(null);
    level.dispose();
    mapIndex = index;
    level = new Level(rapier, MAPS[mapIndex]);
    level.car.params = carParams();
    view.scene.add(level.group);
    remoteCars.attachLevel(level);
    // レース用でないマップに替わったらレースをやめる（レース用ならそのコースでやり直し）
    if (race && !level.course) {
      clearRace();
      hud.setMode('自分で運転');
      touch.refresh();
    }
    resetCar();
    showMinimap();
    hud.setMapName(level.def.name);
    hud.toast(message);
    menu.refresh();
    net.updateJoin({ map: mapIndex });
  };
  /** オンライン対戦の間は、部屋のみんなと同じコースのまま（変えられない） */
  const mapLocked = () => {
    if (!roomRace) return false;
    hud.toast('オンライン対戦の間はコースを変えられません');
    return true;
  };
  const nextMap = () => {
    if (mapLocked()) return;
    // タイムアタック中は、レース用のコースだけを順に替える
    let next = (mapIndex + 1) % MAPS.length;
    while (race && !MAPS[next].race) next = (next + 1) % MAPS.length;
    loadMap(next);
    // 同じ部屋の全員のマップも切り替える
    net.send({ t: 'map', map: mapIndex });
  };
  const selectCar = (index: number) => {
    carIndex = index;
    level.car.params = carParams();
    rebuildCarMesh();
    // ランキングの人のゴーストは、同じ車のときだけ一緒に走る
    setRival(null);
    hud.setCarName(vehicle().label);
    net.send({ t: 'profile', car: vehicle().id });
    net.updateJoin({ car: vehicle().id });
  };
  function setLights(on: boolean, announce = false) {
    lightsOn = on;
    applyLights();
    net.send({ t: 'profile', lights: on });
    net.updateJoin({ lights: on });
    if (announce) hud.toast(on ? 'ヘッドライト ON' : 'ヘッドライト OFF');
    touch.refresh();
  }
  const toggleLights = () => setLights(!lightsOn, true);

  // --- クラクション: 押している間だけ鳴らす（部屋の人にも聞こえる） ---
  const horns = new Horns(
    sound,
    (on) => net.send({ t: 'horn', on }),
    (id) => {
      const p = remoteCars.positionOf(id, performance.now());
      return p ? Math.hypot(p.x - curr.x, p.z - curr.z) : null;
    },
  );

  // --- セリフ（エモート）: 設定で決めたセリフを、自分と部屋のみんなの車の上に吹き出しで出す ---
  const emoteFeed = new EmoteFeed();
  let emote = loadEmote();
  let lastEmoteAt = -Infinity;
  const showEmote = (id: number | null, text: string) => {
    const self = id === null || id === net.id;
    if (self) attachBubble(carMesh.root, text);
    else remoteCars.showBubble(id, text);
    const info = self ? null : remoteCars.list.find((p) => p.id === id);
    const name = self ? loadPlayerName().trim() || 'あなた' : (info?.name ?? '誰か');
    const color = self ? carMesh.color : PLAYER_COLORS[(info?.color ?? 0) % PLAYER_COLORS.length];
    emoteFeed.add(name, color, text);
  };
  const sendEmote = () => {
    const now = performance.now();
    if (now - lastEmoteAt < EMOTE_COOLDOWN_MS) return;
    lastEmoteAt = now;
    // 部屋にいるときはサーバーから返ってきたときに出す（みんなと同時に）
    if (net.isOnline) net.send({ t: 'emote', text: emote });
    else showEmote(null, emote);
  };
  const editEmote = () => {
    void confirmDialog
      .askText({
        title: 'セリフ',
        en: 'MESSAGE',
        lines: [`「セリフ」ボタン（キーボードは E）で言うセリフ。${MAX_EMOTE_LENGTH}文字まで。`],
        ok: '保存',
        safe: true,
        value: emote,
        maxLength: MAX_EMOTE_LENGTH,
        placeholder: DEFAULT_EMOTE,
      })
      .then((text) => {
        if (text === null) return;
        emote = saveEmote(text);
        menu.refresh();
      });
  };

  // --- オンライン対戦: 言い出した人がコース・時間帯・天気を決め、各自が車を選んで一斉にスタート ---
  /** 部屋の対戦の様子（サーバーから届いたもの） */
  let roomRace: RaceState | null = null;
  /** 自分が走っているオンライン対戦の番号と、その最後の様子（全員ゴールして終わった後も結果に使う） */
  let onlineSeq: number | null = null;
  let onlineResult: RaceState | null = null;
  /** 対戦を言い出して、まだ返事が来ていない（ほぼ同時に他の人が言い出していたら、そちらに参加する） */
  let raceOpenSent = false;
  /** 対戦の条件に合わせる（コース・時間帯・天気） */
  const applyRaceSettings = (st: RaceSettings) => {
    if (st.map !== mapIndex && st.map >= 0 && st.map < MAPS.length) loadMap(st.map, `対戦のコース「${MAPS[st.map].name}」に移動しました`);
    const time = TIMES_OF_DAY.find((t) => t.id === st.time)?.id ?? env.time;
    const weather = WEATHERS.find((w) => w.id === st.weather)?.id ?? env.weather;
    if (time !== env.time || weather !== env.weather) setEnvironment(time, weather, false);
  };
  /** スタートの並び（準備 OK にした順に、2列に互い違い） */
  function onlineGridSpot(): Spawn {
    const course = level.course!;
    const i = Math.max(0, onlineResult?.entrants.indexOf(net.id ?? -1) ?? 0);
    const side = Math.min(3, course.widthAt(0) / 4);
    return course.gridSpot(6 + 6 * Math.floor(i / 2) + (i % 2) * 3, i % 2 === 0 ? side : -side);
  }
  function startOnlineRace(r: RaceState) {
    if (race) clearRace();
    applyRaceSettings(r.settings);
    if (!level.course) return;
    const car = VEHICLE_PRESETS.findIndex((v) => v.id === onlineRacePanel.selectedCar);
    if (car >= 0 && car !== carIndex) selectCar(car);
    raceMode = 'online';
    onlineSeq = r.seq;
    onlineResult = r;
    setRival(null);
    const course = level.course;
    race = new TimeAttack(course, level.def.race!.laps, true);
    ghostRecorder = new GhostRecorder();
    best = null;
    placeCar(onlineGridSpot());
    // カウントダウンの間は並んだ車どうしがぶつからないように
    remoteCars.ghost(performance.now(), 6000);
    race.begin();
    raceHud.show(true);
    raceHud.hideResult();
    raceHud.setWarning({ wrongWay: false, offCourse: false });
    showMinimap();
    hud.setMode(raceLabel());
    document.body.classList.add('online-race');
    touch.refresh();
    menu.refresh();
  }
  /** オンラインの部屋から退出する（対戦中なら対戦もやめる） */
  function leaveRoom() {
    if (race && raceMode === 'online') stopRace();
    net.disconnect();
    hud.toast('部屋から退出しました');
  }
  /** 自分だけオンライン対戦から抜ける（まだゴールしていなければサーバーに知らせる） */
  function leaveOnlineRace() {
    if (onlineSeq !== null && roomRace?.seq === onlineSeq && race?.phase !== 'finished') net.send({ t: 'raceCancel' });
    onlineSeq = null;
    onlineResult = null;
    document.body.classList.remove('online-race');
  }
  /** オンライン対戦の順位（自分は自分の計測、他の人は受け取った距離とゴールのタイム） */
  const onlineStandings = () => {
    const r = onlineResult;
    const course = level.course;
    if (!race || !r || !course) return [];
    return rankOnline(
      r.entrants.map((id) => {
        const fin = r.finished.find((f) => f.id === id);
        if (id === net.id) {
          return { name: loadPlayerName().trim() || 'あなた', color: carMesh.color, isPlayer: true, distance: race!.distance(curr.x, curr.z), total: race!.phase === 'finished' ? race!.time : (fin?.time ?? null), laps: race!.laps.length };
        }
        const info = remoteCars.list.find((p) => p.id === id);
        const distance = remoteCars.progressOf(id) ?? -Infinity;
        return {
          name: info?.name ?? '誰か',
          color: PLAYER_COLORS[(info?.color ?? 0) % PLAYER_COLORS.length],
          isPlayer: false,
          distance,
          total: fin?.time ?? null,
          laps: fin ? race!.totalLaps : lapsDone(distance, course.length, course.closed, race!.totalLaps),
        };
      }),
    );
  };
  const onlineRaceView = () =>
    roomRace && net.id !== null
      ? {
          race: roomRace,
          selfId: net.id,
          members: [
            { id: net.id, name: loadPlayerName().trim() || 'あなた', car: vehicle().id, color: carMesh.color },
            ...remoteCars.list.map((p) => ({ id: p.id, name: p.name, car: p.car, color: PLAYER_COLORS[p.color % PLAYER_COLORS.length] })),
          ],
          conditions: `${MAPS[roomRace.settings.map]?.name ?? ''} ／ ${TIMES_OF_DAY.find((t) => t.id === roomRace!.settings.time)?.label ?? ''}・${WEATHERS.find((w) => w.id === roomRace!.settings.weather)?.label ?? ''}`,
        }
      : null;
  /** 部屋の対戦の様子が変わったとき */
  function onRoomRace(r: RaceState | null, by: number, start = false) {
    const prev = roomRace;
    roomRace = r;
    // 言い出したのに、先に他の人が言い出していた: その人の対戦のエントリー画面を開く
    const beaten = raceOpenSent && r?.phase === 'entry' && r.host !== net.id;
    raceOpenSent = false;
    if (r && r.seq === onlineSeq) onlineResult = r;
    // 他の人がゴールしたら、まだ走っている自分に知らせる
    if (r && prev?.seq === r.seq && r.seq === onlineSeq && race && raceMode === 'online' && race.phase === 'racing') {
      r.finished.forEach((f, i) => {
        if (f.id === net.id || prev.finished.some((p) => p.id === f.id)) return;
        const info = remoteCars.list.find((p) => p.id === f.id);
        raceHud.announceFinish(info?.name ?? '誰か', PLAYER_COLORS[(info?.color ?? 0) % PLAYER_COLORS.length], `${i + 1}位　${formatTime(f.time)}`);
      });
    }
    if (!r) {
      onlineRacePanel.update(null);
      // まだ走っている途中で対戦が終わった（言い出した人がやめた・打ち切り）
      if (race && raceMode === 'online' && race.phase !== 'finished') {
        hud.toast(by === net.id ? 'オンライン対戦をやめました' : 'オンライン対戦が終わりました');
        onlineSeq = null;
        stopRace();
      }
    } else if (r.phase === 'entry') {
      const isNew = !prev || prev.seq !== r.seq;
      if (isNew && race) {
        // 自分のレース（タイムアタックなど）はやめて、対戦のコースへ
        if (raceMode === 'online') leaveOnlineRace();
        clearRace();
        hud.setMode('自分で運転');
      }
      applyRaceSettings(r.settings);
      onlineRacePanel.update(onlineRaceView());
      if (isNew || beaten) {
        if (beaten && !isNew) hud.toast(`先に ${nameOf(r.host)} がエントリーを始めていました。こちらに参加してください`);
        else if (by !== net.id) hud.toast(`${nameOf(by)} がオンライン対戦を始めました。車を選んで準備OK（または見送る）にしてください`);
        menu.close();
        rankingPanel.close();
        onlinePanel.close();
        onlineRacePanel.open(vehicle().id);
      }
    } else {
      onlineRacePanel.update(onlineRaceView());
      if (start) {
        if (net.id !== null && r.entrants.includes(net.id)) {
          menu.close();
          startOnlineRace(r);
        } else {
          hud.toast('オンライン対戦が始まりました（今回は見ているだけ）');
        }
      }
    }
    touch.refresh();
    menu.refresh();
    refreshNetStatus();
  }
  /** 時間帯・天気を変える。天気で車の性能が変わるので、レース中ならやり直す */
  const setEnvironment = (time: TimeOfDay, weather: Weather, restart = true) => {
    const weatherChanged = weather !== env.weather;
    const changed = weatherChanged || time !== env.time;
    env.time = time;
    env.weather = weather;
    saveEnvironment(env);
    view.setEnvironment(env);
    // 時間帯・天気が変わったら、ライトもそれに合わせる（後から切り替えられる）
    if (changed) setLights(GameScene.needsHeadlights(env));
    npcField?.setLights(npcLightsOn());
    if (!weatherChanged) return;
    level.car.params = carParams();
    if (race && restart) startRace(raceMode);
  };
  const cycleCar = () => {
    selectCar((carIndex + 1) % VEHICLE_PRESETS.length);
    resetCar();
    hud.toast(`車: ${vehicle().label}（最高 ${Math.round(topSpeedOf(vehicle().params) * 3.6)}km/h）`);
  };

  // --- ランキング ---
  const ranking = new Ranking(serverUrl ? new LeaderboardClient(serverUrl) : null, {
    onRace: (course, car, r) => raceAgainst(course, car, r),
    onOpenChange: (open) => {
      keyboard.enabled = !open;
      touch.enabled = !open;
    },
  });
  const rankingPanel = ranking.panel;
  /** タイムアタックでゴールしたら、自己ベストをランキングに送って順位を結果に出す */
  function reportToRanking(newBest: boolean) {
    raceHud.showRankingButton(ranking.available);
    if (!ranking.available) return;
    if (!loadPlayerName().trim()) {
      raceHud.setResultNote('名前を入れると、自己ベストがランキングに載ります（ランキングの画面で入力）');
      return;
    }
    if (!newBest) return;
    raceHud.setResultNote('ランキングに送っています…');
    ranking.uploadBest(level.def, vehicle().id).then(
      (r) => r && raceHud.setResultNote(r.rank !== null ? `ランキング ${r.rank}位` : `ランキングの上位には入りませんでした`),
      () => raceHud.setResultNote('ランキングに送れませんでした（通信エラー）'),
    );
  }
  /** ランキングで選んだ人のゴーストと、そのコース・車でタイムアタックする */
  function raceAgainst(course: string, car: string, r: RankedGhost) {
    const map = MAPS.findIndex((m) => m.id === course);
    const vehicleIndex = VEHICLE_PRESETS.findIndex((v) => v.id === car);
    if (vehicleIndex >= 0 && vehicleIndex !== carIndex) selectCar(vehicleIndex);
    if (map >= 0 && map !== mapIndex) {
      loadMap(map);
      net.send({ t: 'map', map: mapIndex });
    }
    startRace('timeAttack');
    setRival(r);
    hud.toast(`${r.name} さんのゴーストと対戦（${formatTime(r.total)}）`);
  }
  function openRanking() {
    if (!ranking.available) {
      hud.toast('このサイトにはオンライン用のサーバーがまだ設定されていません');
      return;
    }
    ranking.open(level.def);
  }
  const cycleCamera = () => {
    cameraRig.cycle();
    hud.setCameraName(cameraRig.modeName);
  };
  const toggleMute = () => {
    const muted = sound.toggleMute();
    hud.setMuted(muted);
  };
  // --- オンライン ---
  const netStatus = document.getElementById('net-status')!;
  let roomCode = '';
  const nameOf = (id: number) => remoteCars.list.find((p) => p.id === id)?.name ?? '誰か';
  const refreshNetStatus = () => {
    const online = net.status !== 'offline' && net.status !== 'error';
    netStatus.classList.toggle('hidden', !online);
    if (!online) return;
    netStatus.innerHTML = netStatusHtml({
      roomCode,
      connected: net.status === 'online',
      selfColor: carMesh.color,
      others: remoteCars.list.map((p) => ({ name: p.name, color: PLAYER_COLORS[p.color % PLAYER_COLORS.length] })),
      race: roomRace?.phase ?? null,
      maxPlayers: MAX_PLAYERS,
    });
  };
  const net: NetClient = new NetClient({
    onStatus: (status, detail) => {
      if (status === 'offline' || status === 'error' || status === 'reconnecting') {
        if (roomRace || onlineSeq !== null) {
          if (race && raceMode === 'online') stopRace();
          onlineSeq = null;
          roomRace = null;
          onlineRacePanel.update(null);
        }
        horns.stopRemote();
      }
      if (status === 'offline' || status === 'error') {
        remoteCars.clear();
        assignedColor = null;
        carMesh.setColor(carStyle(vehicle().id).color);
      }
      if (status === 'reconnecting') remoteCars.clear();
      onlinePanel.setConnected(status === 'online' || status === 'connecting' || status === 'reconnecting');
      onlinePanel.setStatus(
        detail ??
          (status === 'online'
            ? `部屋 ${roomCode} に参加しています`
            : status === 'connecting' || status === 'reconnecting'
              ? '接続しています…'
              : ''),
      );
      if (detail) hud.toast(detail);
      refreshNetStatus();
    },
    onMessage: (m) => {
      const now = performance.now();
      switch (m.t) {
        case 'welcome':
          remoteCars.clear();
          for (const p of m.players) remoteCars.add(p);
          assignedColor = PLAYER_COLORS[m.color % PLAYER_COLORS.length];
          carMesh.setColor(assignedColor);
          if (m.map !== mapIndex && m.map >= 0 && m.map < MAPS.length) loadMap(m.map, `部屋のマップ「${MAPS[m.map].name}」に移動しました`);
          hud.toast(`部屋 ${roomCode} に参加しました。対戦はメニューの「対戦のエントリーを始める」から`);
          onlinePanel.close();
          // 部屋でエントリー中なら、そのエントリー画面が開く（途中から来ても出られる）
          if (m.race) onRoomRace(m.race, m.race.host);
          if (m.race?.phase === 'racing') hud.toast('部屋ではオンライン対戦の最中です（終わったら参加できます）');
          break;
        case 'join':
          remoteCars.add(m.player);
          hud.toast(`${m.player.name} が来ました`);
          // エントリー中なら、来た人の準備OKも待つ
          if (roomRace?.phase === 'entry') onlineRacePanel.update(onlineRaceView());
          break;
        case 'leave':
          hud.toast(`${nameOf(m.id)} が抜けました`);
          horns.remote(m.id, false);
          remoteCars.remove(m.id);
          if (roomRace?.phase === 'entry') onlineRacePanel.update(onlineRaceView());
          break;
        case 'horn':
          horns.remote(m.id, m.on);
          break;
        case 'emote':
          showEmote(m.id, m.text);
          break;
        case 'race':
          onRoomRace(m.race, m.by, m.start);
          break;
        case 'profile':
          remoteCars.update(m.player);
          if (roomRace?.phase === 'entry') onlineRacePanel.update(onlineRaceView());
          break;
        case 'state':
          remoteCars.pushState(m.id, m.time, m.s, now, m.p);
          break;
        case 'map':
          if (m.map >= 0 && m.map < MAPS.length && m.map !== mapIndex) {
            loadMap(m.map, `${nameOf(m.by)} がマップを「${MAPS[m.map].name}」に変えました`);
          }
          break;
      }
      refreshNetStatus();
    },
  });
  const onlinePanel = new OnlinePanel(
    {
      onJoin: (name, room) => {
        roomCode = room;
        net.connect(serverUrl, room, { name, car: vehicle().id, map: mapIndex, lights: lightsOn });
      },
      onLeave: () => leaveRoom(),
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
      },
    },
    serverUrl !== '',
  );
  const onlineRacePanel = new OnlineRacePanel(
    VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, note: `${driveOf(v) ?? ''}${driveOf(v) ? '・' : ''}最高 ${Math.round(topSpeedOf(v.params) * 3.6)}km/h` })),
    vehicle().id,
    (id) => VEHICLE_PRESETS.find((v) => v.id === id)?.label ?? id,
    {
      onReady: (ready, car) => {
        const index = VEHICLE_PRESETS.findIndex((v) => v.id === car);
        if (index >= 0 && index !== carIndex) {
          selectCar(index);
          resetCar();
        }
        net.send({ t: 'raceReady', ready, car });
      },
      onStart: (undecided) => {
        if (undecided === 0) return net.send({ t: 'raceStart' });
        void confirmDialog
          .ask({
            title: '準備OKの人だけでスタート',
            en: 'START',
            lines: [`まだ${undecided}人が車を選んでいます。`, 'いまスタートすると、その人は今回は見ているだけになります。'],
            ok: 'スタート',
            safe: true,
          })
          .then((ok) => ok && net.send({ t: 'raceStart' }));
      },
      onLeave: () => {
        const isHost = roomRace?.host === net.id;
        net.send({ t: 'raceCancel' });
        onlineRacePanel.close();
        if (!isHost) hud.toast('今回の対戦は見送ります。出るときはメニューの「エントリー画面」から');
      },
      onOpenChange: (open) => {
        keyboard.enabled = !open;
        touch.enabled = !open;
      },
    },
  );
  let stepCount = 0;
  /** アクセルを踏みっぱなしか（スタートは踏み直したときだけにする） */
  let throttleHeld = false;

  const keyboard = new KeyboardInput();
  keyboard.smoothSteer = loadSmoothKeySteer();
  keyboard.onAction('KeyO', () => onlinePanel.open());
  keyboard.onAction('KeyL', openRanking);
  keyboard.onAction('KeyR', resetCar);
  keyboard.onAction('KeyT', () => toggleRace('timeAttack'));
  keyboard.onAction('KeyY', () => toggleRace('npc'));
  keyboard.onAction('KeyB', () => toggleRace('battle'));
  keyboard.onAction('KeyC', cycleCamera);
  keyboard.onAction('KeyN', nextMap);
  keyboard.onAction('KeyP', cycleCar);
  keyboard.onAction('KeyM', toggleMute);
  keyboard.onAction('KeyH', () => hud.toggleHelp());
  keyboard.onAction('KeyK', () => race && raceMode === 'npc' && cycleNpcLevel());
  keyboard.onAction('KeyF', toggleLights);
  keyboard.onAction('KeyE', sendEmote);

  const gamepad = new GamepadInput();
  gamepad.onButton(PAD_BUTTON.north, cycleCamera);
  gamepad.onButton(PAD_BUTTON.start, resetCar);
  gamepad.onButton(PAD_BUTTON.select, nextMap);
  // セリフの場面は A ボタンでも進める
  gamepad.onButton(PAD_BUTTON.south, () => subtitles.advance());

  // --- スマホのタッチ操作 ---
  const touch = new TouchControls(
    [
      {
        label: () => 'カメラ',
        run: () => {
          cycleCamera();
          hud.toast(`カメラ: ${cameraRig.modeName}`);
        },
      },
      { label: () => (lightsOn ? 'ライト ON' : 'ライト OFF'), run: toggleLights, place: 'side' },
      { label: () => 'ホーン', run: () => {}, hold: (down) => (horns.input.touch = down), place: 'side' },
      { label: () => 'セリフ', run: sendEmote, place: 'side' },
      { label: () => 'エントリー', run: () => onlineRacePanel.open(), visible: () => roomRace?.phase === 'entry' && !onlineRacePanel.isOpen },
    ],
    // ☰ は押すたびにポーズ画面を開く・閉じる
    () => (menu.isOpen ? menu.close() : menu.openPause()),
  );

  /** 確認・入力の画面（プレイデータを消す、セリフを書き換える、など） */
  const confirmDialog = new ConfirmDialog();
  const { menu, openChangeFlow } = createGameMenu({
    level: () => level,
    race: () => race,
    raceMode: () => raceMode,
    raceLabel,
    current: () => ({
      map: level.def.id,
      car: vehicle().id,
      npc: NPC_LEVELS[npcLevelIndex].id,
      rival: battleRival().id,
      rule: battleRule,
      rough: battleRough,
      time: env.time,
      weather: env.weather,
      opponentLights,
    }),
    apply: (mode, choices) => {
      setEnvironment(choices.time, choices.weather, false);
      const car = VEHICLE_PRESETS.findIndex((v) => v.id === choices.car);
      if (car >= 0 && car !== carIndex) selectCar(car);
      npcLevelIndex = Math.max(0, NPC_LEVELS.findIndex((l) => l.id === choices.npc));
      battleIndex = Math.max(0, RIVALS.findIndex((r) => r.id === choices.rival));
      battleRule = choices.rule;
      battleRough = choices.rough;
      opponentLights = choices.opponentLights;
      if (mode === 'free') stopRace();
      const map = MAPS.findIndex((m) => m.id === choices.map);
      if (map >= 0 && map !== mapIndex && !mapLocked()) {
        loadMap(map);
        // 同じ部屋の全員のマップも切り替える
        net.send({ t: 'map', map: mapIndex });
      }
      if (mode !== 'free') startRace(mode);
      else resetCar();
    },
    startRace: (mode) => startRace(mode),
    stopRace,
    resetCar,
    openRanking,
    hasRanking: ranking.available,
    toast: (message) => hud.toast(message),
    online: {
      available: serverUrl !== '',
      isOnline: () => net.isOnline,
      selfId: () => net.id,
      roomCode: () => roomCode,
      roomRace: () => roomRace,
      nameOf,
      openJoin: (note) => onlinePanel.open(note),
      openEntry: () => onlineRacePanel.open(),
      openRace: (settings) => {
        raceOpenSent = true;
        net.send({ t: 'raceOpen', settings });
      },
      leaveRoom,
    },
    settings: settingItems({
      cameraRig,
      mirrors,
      sound,
      bgm,
      touch,
      keyboard,
      cycleCamera,
      toggleMute,
      toggleSteerMode: () => void toggleSteerMode(),
      emote: () => emote,
      editEmote,
      // まちがって消さないよう、確認の画面で「消す」を選んだときだけ消す
      clearPlayData: () => {
        void confirmDialog
          .ask({
            title: 'プレイデータを消す',
            en: 'DELETE DATA',
            lines: ['自己ベスト・ゴースト・勝ったライバルの記録を消します。', '消した記録は元に戻せません。'],
            ok: '消す',
          })
          .then((ok) => {
            if (!ok) return;
            clearPlayData();
            best = null;
            hud.toast('プレイデータを消しました');
            menu.refresh();
          });
      },
      toast: (message) => hud.toast(message),
    }),
    onOpenChange: (open) => {
      keyboard.enabled = !open;
      touch.enabled = !open;
      document.body.classList.toggle('menu-open', open);
      if (!open) cameraRig.snap();
    },
    canOpen: () => !onlinePanel.isOpen && !rankingPanel.isOpen && !onlineRacePanel.isOpen,
  });
  touch.refresh();

  async function toggleSteerMode() {
    const next = touch.steerMode === 'tilt' ? 'drag' : 'tilt';
    const ok = await touch.setSteerMode(next);
    if (next === 'tilt') hud.toast(ok ? '傾けてハンドル。今の持ち方がまっすぐです' : 'この端末では傾きを使えません');
    touch.refresh();
    menu.refresh();
  }

  // スマホ・タブレットなら最初から、そうでなくても画面に触れたら操作画面を出す（?touch で強制表示）
  if (prefersTouch() || params.has('touch')) touch.show();
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || touch.isShown) return;
    touch.show();
    // スマホの操作画面では地図が小さくなるので描き直す
    showMinimap();
  });
  showMinimap();
  window.addEventListener('resize', showMinimap);

  // ブラウザの制約で、音はユーザー操作の後でないと鳴らせない（タッチは指を離したときが操作とみなされる）
  const unlockAudio = () => {
    sound.start();
    bgm.start(sound.context);
  };
  window.addEventListener('keydown', unlockAudio);
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('pointerup', unlockAudio);
  window.addEventListener('touchend', unlockAudio);
  window.addEventListener('click', unlockAudio);

  hud.setCameraName(cameraRig.modeName);
  hud.setMapName(level.def.name);
  hud.setCarName(vehicle().label);
  hud.setMuted(sound.isMuted);
  hud.setMode('自分で運転');
  if (touch.isShown && window.innerHeight > window.innerWidth) hud.toast('横向きにすると遊びやすくなります');

  const loop = new FixedStepLoop(
    (dt) => {
      const pad = gamepad.read();
      hud.setGamepadConnected(gamepad.isConnected);
      input = mergeInputs(mergeInputs(keyboard.read(), pad), touch.read());
      horns.input.key = keyboard.isDown('KeyG');
      horns.update();
      // スタートの位置で待っている間は、アクセルを踏み直したらカウントダウンを始める
      if (race?.phase === 'ready' && input.throttle > 0 && !throttleHeld) beginRace();
      throttleHeld = input.throttle > 0;
      // カウントダウン中は発進させない（ハンドルだけ切れる）
      if (race && !race.canDrive) input = { ...NEUTRAL_INPUT, steer: input.steer };
      if (fall.falling) input = NEUTRAL_INPUT;
      remoteCars.step(performance.now());
      level.physics.world.timestep = dt;
      level.car.applyInput(input, dt);
      npcField?.applyInputs(dt, race?.canDrive ?? false, [curr]);
      // ラフプレーのライバルにぶつけられたら、外へ押し出されてスピンしかける
      const hit = npcField?.takeHit();
      if (hit && !fall.falling) {
        level.car.bump(hit.push, hit.yawRate, hit.time);
        talk.bumped();
      }
      level.physics.world.step();
      npcField?.afterStep(dt);

      const impact = level.car.measureImpact();
      lastImpact = impact;
      if (impact > IMPACT_THRESHOLD) {
        sound.impact(impact);
        cameraRig.addShake(impact);
      }

      prev = curr;
      curr = level.car.snapshot();
      // マップ外に落ちた場合の保険
      if (curr.y < -5) resetCar();
      switch (fall.update(dt, level, level.car, curr)) {
        case 'fell':
          hud.toast('コースアウト！');
          sound.impact(6);
          break;
        case 'recovered':
          prev = curr = level.car.snapshot();
          air.reset(groundAt(curr));
          cameraRig.snap();
          remoteCars.ghost(performance.now());
          break;
      }
      // 段差で浮いている間はタイヤが効かない。強く着地したら音と揺れ
      const landing = air.update(dt, groundAt(curr));
      level.car.airborne = air.inAir && !fall.falling;
      if (landing !== null && landing > LANDING_THRESHOLD) {
        sound.impact(landing);
        cameraRig.addShake(landing * 0.25);
      }
      // 草地を走るとガタガタ揺れる
      const grass = level.car.offRoad?.(curr.x, curr.z) ?? 0;
      if (grass > 0 && !fall.falling) cameraRig.addShake(grass * Math.min(1, Math.abs(curr.forwardSpeed) / 15) * 0.6);
      // 溝落とし: 内側のタイヤが側溝に落ちている間は、ゴトゴト揺れる
      if (level.car.gutter?.(curr.x, curr.z) && !fall.falling) cameraRig.addShake(Math.min(1, Math.abs(curr.forwardSpeed) / 15) * 0.25);
      // 荒れた路面でも小刻みに揺れる
      const rough = level.roughnessAt(curr.x, curr.z, curr.courseS);
      if (rough > 0 && !fall.falling) cameraRig.addShake(rough * Math.min(1, Math.abs(curr.forwardSpeed) / 25) * 0.3);
      if (race) {
        const r = race;
        r.update(dt, { x: curr.x, z: curr.z, ...velocityOf(curr) });
        if (r.phase === 'racing') ghostRecorder.sample(r.time, curr);
        const npc0 = npcField?.npcs[0];
        if (sections && npc0) {
          trackSections(sections.me, r, curr);
          trackSections(sections.them, npc0.timer, npc0.curr);
        }
        handleRaceEvents(r);
        announceNpcFinishes(r);
        judgeSuddenDeath();
        const npc = npcField?.npcs[0];
        if (npc) talk.update({ race: r, npc, level, car: curr, impact: lastImpact });
        if (debugWhere) {
          const d = r.distance(curr.x, curr.z);
          debugWhere.textContent = `${r.lap}周目 ${Math.round(level.course?.closed ? d - (r.lap - 1) * level.course.length : d)}m`;
        }
      }
      // タブが裏に回っている間は送らない（他の人からは止まって見え、やがて放置として部屋から外れる）
      if (net.isOnline && !document.hidden && ++stepCount % SEND_EVERY_STEPS === 0) {
        const progress = race && raceMode === 'online' && onlineSeq !== null ? race.distance(curr.x, curr.z) : undefined;
        net.send({ t: 'state', time: performance.now(), s: carStateOf(curr), ...(progress !== undefined ? { p: Math.round(progress * 10) / 10 } : {}) });
      }

    },
    (alpha, frameDt) => {
      subtitles.update(frameDt);
      const s = level.ground(lerpSnapshot(prev, curr, alpha));
      s.y += air.gap - fall.drop;
      carMesh.update(s);
      view.followCar(carMesh.root);
      remoteCars.render(performance.now());
      horns.updateVolumes();
      npcField?.render(alpha);
      // 他の人や NPC のヘッドライトで、自分の画面の道も照らす（近い車だけ）
      const litCars = [...remoteCars.litCars(), ...(npcField?.litCars() ?? [])];
      view.setRemoteHeadlights(nearestLit(litCars, s.x, s.z).map((c) => c.root));
      let minimapRace: MinimapMarker[] = [];
      if (race) {
        const pose = best ? ghostPoseAt(best.ghost, Math.max(0, race.time)) : null;
        const list = npcField ? standings() : raceMode === 'online' ? onlineStandings() : null;
        const rank = list && list.length > 0 ? { list, index: list.findIndex((e) => e.isPlayer) } : null;
        ghostMesh.root.visible = pose !== null;
        if (pose) ghostMesh.update(ghostSnapshot(pose, 'best'));
        const rivalPose = rival && raceMode === 'timeAttack' ? ghostPoseAt(rival.ghost, Math.max(0, race.time)) : null;
        rivalMesh.root.visible = rivalPose !== null;
        if (rivalPose) rivalMesh.update(ghostSnapshot(rivalPose, 'rival'));
        raceHud.update({
          lap: race.lap,
          totalLaps: race.totalLaps,
          time: race.time,
          best: best?.total ?? null,
          laps: race.laps,
          lapTime: race.lapTime,
          refLaps: best?.laps,
          finished: race.phase === 'finished',
          position: rank ? { rank: rank.index + 1, total: rank.list.length } : undefined,
          // オンライン対戦は最大8人なので、上位3人と自分だけ
          field: rank && raceMode === 'online' ? standingsWindow(rank.list).map(({ rank: n, entry }) => ({ ...entry, rank: n })) : rank?.list,
          rival: rival && raceMode === 'timeAttack' ? { name: rival.name, total: rival.total } : undefined,
          battle: battleInfo(),
        });
        // ゴールした後も、まだ走っている NPC がゴールするたびに順位表を更新する（先行後追いは別の結果）
        if (rank && race.phase === 'finished' && !suddenDeath) raceHud.showStandings(rank.list, race.totalLaps, raceMode === 'battle', sectionReport());
        minimapRace = [
          ...(pose ? [{ x: pose.x, z: pose.z, color: '#7fd4ff' }] : []),
          ...(rivalPose ? [{ x: rivalPose.x, z: rivalPose.z, color: '#ffa040' }] : []),
          ...(npcField?.npcs.map((n) => ({ x: n.curr.x, z: n.curr.z, color: hex(n.color) })) ?? []),
        ];
      }
      // 地図: ゴースト・NPC と、部屋の他の人（オンライン対戦中はエントリーした人だけ）と自分
      const others = race && raceMode === 'online' ? (onlineResult?.entrants ?? []) : race ? [] : remoteCars.list.map((p) => p.id);
      minimap.draw([
        ...minimapRace,
        ...others.flatMap((id) => {
          const p = id === net.id ? null : remoteCars.positionOf(id, performance.now());
          const info = remoteCars.list.find((x) => x.id === id);
          return p && info ? [{ x: p.x, z: p.z, color: hex(PLAYER_COLORS[info.color % PLAYER_COLORS.length]) }] : [];
        }),
        { x: s.x, z: s.z, yaw: s.yaw, color: '#ff5a4f', size: 5 },
      ]);
      level.syncProps();
      // タイトル・メニューの間は、止まっている車の周りをカメラが回る
      if (menu.showcase) cameraRig.orbit(s, frameDt);
      else cameraRig.update(s, frameDt);
      view.followTarget(s.x, s.z, s.y);
      view.update(frameDt, cameraRig.camera);
      hud.update(s);
      sound.update(s.forwardSpeed, input.throttle, s.lateralSpeed, input.brake > 0 && s.forwardSpeed > 0);
      view.fitToWindow(cameraRig.camera);
      view.render(cameraRig.camera);
      const showMirrors = mirrors.mode !== 'off' && !menu.showcase && !document.body.classList.contains('menu-open');
      if (showMirrors && mirrorRegionAge-- <= 0) {
        mirrorRegion = measureMirrorRegion();
        mirrorRegionAge = 10;
        // ミラーの下に、周回・タイムや操作説明などをずらす
        document.body.style.setProperty('--mirror-bottom', `${mirrors.bottom(mirrorRegion) + 8}px`);
      }
      // スマホの縦向きでは、上の表示をまとめてミラーの下へ（ポーズ中は ☰ が動かないよう、そのまま）
      if (!menu.isOpen) {
        const shift = showMirrors && touch.isShown && window.innerHeight > window.innerWidth ? mirrors.bottom(mirrorRegion) : 0;
        document.body.style.setProperty('--top-shift', `${shift}px`);
      }
      document.body.classList.toggle('mirrors-on', showMirrors);
      document.body.classList.toggle('menu-driving', menu.isOpen && !menu.showcase);
      mirrors.render(view.renderer, view.scene, carMesh.root, showMirrors, mirrorRegion);
    },
  );

  // ?debug を付けるとブラウザの開発者ツールや自動テストから状態を触れる
  if (params.has('debug')) {
    Object.assign(window, {
      __game: { getLevel: () => level, getRace: () => race, getNpcs: () => npcField, getSuddenDeath: () => suddenDeath, menu, startTimeAttack: () => startRace('timeAttack'), startNpcRace: () => startRace('npc'), startBattle: (index = battleIndex) => { battleIndex = index; startRace('battle', true); }, subtitles, stopRace, openRanking, rankingPanel, net, remoteCars, touch, onlinePanel, cameraRig, sound },
    });
  }

  hideLoading();
  loop.start();
  // タイトル画面から始める（?map= でマップを指定して開いたときは、すぐに走れるようにする）
  if (!params.has('map') && !params.has('room')) menu.openTitle();

  // 招待リンク（?room=XXXX）から開いたら、参加画面を出す
  const invited = normalizeRoomCode(params.get('room') ?? '');
  if (isRoomCode(invited)) {
    onlinePanel.presetRoom(invited);
    onlinePanel.open();
  }
}

main().catch((err) => {
  console.error(err);
  showError(`起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
});
