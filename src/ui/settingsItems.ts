import type { BgmPlayer } from '../audio/bgm';
import type { SoundSystem } from '../audio/sound';
import { type KeyboardInput, saveSmoothKeySteer } from '../core/input';
import { MAX_EMOTE_LENGTH } from '../net/protocol';
import type { CameraRig } from '../render/camera';
import { MIRROR_MODES, type Mirrors, saveMirrorMode } from '../render/mirrors';
import { canRequestFullscreen, enterFullscreen, isFullscreen, isStandalone, needsHomeScreenForFullscreen } from './fullscreen';
import type { MenuItem } from './menu';
import { textDetail } from './menuDetails';
import type { TouchControls } from './touchControls';

/** 設定の項目の右側の説明 */
export const settingDetail = (title: string, lines: string[]) => () => textDetail({ kicker: 'OPTIONS', title, lines });

export interface SettingsContext {
  cameraRig: CameraRig;
  mirrors: Mirrors;
  sound: SoundSystem;
  bgm: BgmPlayer;
  touch: TouchControls;
  keyboard: KeyboardInput;
  cycleCamera: () => void;
  toggleMute: () => void;
  toggleSteerMode: () => void;
  /** いまのセリフ（エモート）と、それを書き換える画面を開く */
  emote: () => string;
  editEmote: () => void;
  /** 「プレイデータを消す」（確認の画面を出してから消す） */
  clearPlayData: () => void;
  toast: (message: string) => void;
}

/** 設定の画面の項目 */
export function settingItems(c: SettingsContext): MenuItem[] {
  return [
    { label: () => 'カメラ', value: () => c.cameraRig.modeName, run: () => c.cycleCamera(), detail: settingDetail('カメラ', ['走っているときの視点。走行中は C キーでも切り替えられます。']) },
    {
      label: () => 'ミラー',
      value: () => MIRROR_MODES.find((m) => m.id === c.mirrors.mode)!.label,
      run: () => {
        const i = MIRROR_MODES.findIndex((m) => m.id === c.mirrors.mode);
        c.mirrors.mode = MIRROR_MODES[(i + 1) % MIRROR_MODES.length].id;
        saveMirrorMode(c.mirrors.mode);
      },
      detail: settingDetail('ミラー', ['走っているときに出すミラー。押すたびに「なし → バックミラー → サイドのみ → バック＋サイド」と切り替わります。', '古いスマホで重いときは「なし」にしてください。']),
    },
    { label: () => '効果音', value: () => (c.sound.isMuted ? 'OFF' : 'ON'), run: c.toggleMute, detail: settingDetail('効果音', ['エンジン音・タイヤの音・ぶつかった音。M キーでも切り替えられます。']) },
    {
      label: () => 'BGM',
      value: () => c.bgm.choiceLabel,
      run: () => {
        c.sound.start();
        c.bgm.start(c.sound.context);
        c.bgm.cycle();
      },
      visible: () => c.bgm.tracks.length > 0,
      detail: settingDetail('BGM', ['ゲーム中に流す曲。押すたびに「なし → 曲 → シャッフル」と切り替わります。', `曲: ${c.bgm.tracks.map((t) => t.title).join('／')}`]),
    },
    {
      label: () => 'BGMの音量',
      value: () => c.bgm.volumeLabel,
      run: () => c.bgm.cycleVolume(),
      visible: () => c.bgm.isOn,
      detail: settingDetail('BGMの音量', ['小・中・大の3段階。']),
    },
    {
      label: () => 'ハンドル',
      value: () => (c.touch.steerMode === 'tilt' ? '傾ける' : 'なぞる'),
      run: c.toggleSteerMode,
      visible: () => c.touch.isShown,
      detail: settingDetail('ハンドル（スマホ）', ['画面を左右になぞるか、スマホを傾けてハンドルを切る。']),
    },
    {
      label: () => 'キーのハンドル',
      value: () => (c.keyboard.smoothSteer ? 'なめらか' : 'すぐ全開'),
      run: () => {
        c.keyboard.smoothSteer = !c.keyboard.smoothSteer;
        saveSmoothKeySteer(c.keyboard.smoothSteer);
      },
      visible: () => !c.touch.isShown,
      detail: settingDetail('キーのハンドル（キーボード）', [
        'なめらか: 軽く叩くと少しだけ切れ、押し続けるほど深く切れる。細かい修正がしやすい。',
        'すぐ全開: 押した瞬間から目いっぱい切る（前の操作感）。',
        'コントローラーやスマホの操作には関係しません。',
      ]),
    },
    {
      label: () => '全画面',
      value: () => (isFullscreen() ? 'ON' : 'OFF'),
      run: () => void enterFullscreen(),
      visible: () => canRequestFullscreen() && !isStandalone(),
      detail: settingDetail('全画面', ['ブラウザのアドレスバーなどを隠して、画面いっぱいで遊ぶ。']),
    },
    {
      label: () => 'ホーム画面に追加',
      value: () => '案内',
      run: () => c.toast('共有ボタン（□に↑）から「ホーム画面に追加」'),
      visible: () => needsHomeScreenForFullscreen(),
      detail: settingDetail('ホーム画面に追加（iPhone）', [
        'アドレスバーを消して遊ぶには、Safari の共有ボタン（□に↑）から「ホーム画面に追加」を選び、追加したアイコンから開いてください。',
      ]),
    },
    {
      label: () => 'セリフ',
      // 長いセリフは一覧の幅に収まるよう途中まで（全部は押したときの入力の画面で見える）
      value: () => {
        const emote = c.emote();
        return [...emote].length > 8 ? `${[...emote].slice(0, 7).join('')}…` : emote;
      },
      run: c.editEmote,
      detail: settingDetail('セリフ', [
        '「セリフ」ボタン（キーボードは E）を押したときに言うセリフ。押すと入力の画面が出ます。',
        `自分の車の上に吹き出しで出て、部屋にいれば全員に見えます。${MAX_EMOTE_LENGTH}文字まで。空にすると最初のセリフに戻ります。`,
      ]),
    },
    {
      label: () => 'プレイデータを消す',
      value: () => '消す',
      run: c.clearPlayData,
      detail: settingDetail('プレイデータを消す', [
        'このブラウザに残っている、タイムアタックの自己ベストとゴースト・勝ったライバルの記録を消します。',
        '名前・サウンド・ハンドルなどの設定は残ります。ランキングに送った記録は消えません。',
        '押すと確認の画面が出ます。消した記録は元に戻せません。',
      ]),
    },
  ];
}
