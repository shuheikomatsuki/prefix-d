import type { RivalDialogue } from './dialogue';

/**
 * ライバルとのバトルのセリフ。ここを書き換えると、ゲームの中のセリフが変わる。書き方は docs/dialogue.md。
 *
 * - キーはライバルの id（src/race/rivals.ts の RIVALS）。書いていないライバルはセリフなし
 * - 書かなければ、ライバルの得意なコースでバトルしたときだけ出る（onlyHomeCourse: false でどのコースでも）
 * - who: ライバルの id、'player'（自分）、下の CHARACTERS の id。どれでもなければ、書いた文字をそのまま名前として出す
 * - ?debug を付けて開くと、走っている間に「いまの場所（スタートからの距離）」が画面の左下に出る（at を決めるのに使う）
 * - 効果音の字幕は who: 'sfx'。sound: 'slap' のように書くと、public/sounds/slap.mp3 を鳴らす（無ければ合成した音）
 */
export const RIVAL_DIALOGUES: Readonly<Record<string, RivalDialogue>> = {
  iketani: {
    intro: [{ say: [{ who: 'iketani', text: 'わりーな 本気で走るときは助手席にヒトを乗せないことにしてんだ！！' }] }],
  },

  nakazato: {
    intro: [{ say: [{ who: 'nakazato', text: 'サーキットで最強のマシンは公道でも最強だぜ！' }] }],
    race: [
      // 中盤から後、中里が前で、あまり離されずについて来られているとき
      {
        when: { progress: { min: 0.4 }, position: 'behind', gap: { max: 15 } },
        say: [{ who: 'nakazato', text: 'クソッタレー手ごわい！' }],
      },
      // 中里が前にいるとき（スタート直後の横並びは除く）
      {
        when: { position: 'behind', gap: { min: 5 }, elapsed: { min: 5 } },
        say: [{ who: 'nakazato', text: 'リアサイドについているRのバッジは不敗神話のRだ！！ オレのRについて来れるか！？' }],
      },
      // 終盤、中里が前だが、すぐ後ろまで迫られたとき
      {
        when: { progress: { min: 0.7 }, position: 'behind', gap: { max: 6 } },
        say: [{ who: 'nakazato', text: 'なめてんじゃねーぞっ！！ 外から行かすかよ！！' }],
      },
      // 中里がコーナーで外へはみ出したか、インから抜かれたとき
      {
        when: { event: ['rivalWide', 'overtakeInside'] },
        say: [{ who: 'nakazato', text: 'しまったァア 肝心なところでアンダーを出しちまったぜっ！！' }],
      },
    ],
  },

  iwaki: {
    intro: [{ say: [{ who: 'iwaki', text: 'ジョーダンは顔だけにしておいてくれよ、少年' }] }],
    race: [{ when: { position: 'behind', elapsed: { min: 8 } }, say: [{ who: 'iwaki', text: '峠の王者はランエボだ！！' }] }],
    // 清次が負けた（自分が勝った）あと: 須藤京一に引っ叩かれる
    win: [
      {
        say: [
          { who: 'sfx', text: 'バシィッ！！\n（須藤京一が岩城清次を引っ叩く）', sound: 'slap' },
          { who: 'sudo', text: 'いろは坂のサルじゃねえんだから、ちったァ頭使えよ' },
        ],
      },
    ],
  },

  sudo: {
    intro: [{ say: [{ who: 'sudo', text: 'おまえに教えてやる これは講習会（セミナー）だ' }] }],
    race: [
      { when: { elapsed: { min: 10 } }, say: [{ who: 'sudo', text: 'ハイパワーターボ プラス 4WD この条件にあらずんばクルマにあらずだ' }] },
      // 終盤、京一が前だが、差が詰まったとき
      { when: { progress: { min: 0.7 }, position: 'behind', gap: { max: 8 } }, say: [{ who: 'sudo', text: 'オレのエボⅢは曲がる！！' }] },
    ],
  },

  keisuke: {
    // 先行後追いで啓介が先行（自分が後追い）のとき
    intro: [
      {
        when: { rule: 'suddenDeath', playerLeads: false },
        say: [{ who: 'keisuke', text: '上等じゃねーか！！ コーナー2コも抜けりゃバックミラーから消してみせるぜ！！' }],
      },
    ],
    race: [
      // 啓介が前だが、差が詰まっているとき（スタート直後は除く）
      {
        when: { position: 'behind', gap: { max: 8 }, elapsed: { min: 15 } },
        say: [{ who: 'keisuke', text: 'どうしたんだ 今日に限ってFDがやけにノロく感じる！！\nクソッタレが セカンダリータービン止まってんじゃのーのか！！' }],
      },
    ],
  },

  hoshino: {
    race: [
      { when: { position: 'behind', elapsed: { min: 8 } }, say: [{ who: 'hoshino', text: 'オレは死ぬまで…GT-Rだ！！' }] },
      // コーナーに入るたびのかけ声（順に1つずつ。ほかのセリフが出ている間は言わない）
      {
        when: { event: 'rivalCorner' },
        repeat: true,
        oneAtATime: true,
        onlyWhenQuiet: true,
        say: [
          { who: 'hoshino', text: 'どりゃー！！' },
          { who: 'hoshino', text: 'ふりゃあぁー！' },
          { who: 'hoshino', text: 'うぉぉりゃぁあー！！' },
          { who: 'hoshino', text: 'そりゃゃゃあぁあー！！' },
        ],
      },
    ],
  },

  // 八方ヶ原風の峠（往復）: 第2セクションは 700m、ハイポイントコーナーの先の第3セクションは 1450m、谷の橋は 1990m から
  tachi: {
    intro: [
      {
        say: [
          {
            who: 'tachi',
            text: 'やると決めたからには素人が相手でも手加減はしない\nプロとアマの間にどれくらいの差があるのか、お前らもよくみておけよ。',
          },
        ],
      },
    ],
    race: [
      {
        when: { at: 710 },
        say: [
          {
            who: 'tachi',
            text: '見通しが悪く狭かった道路がここから急に変わる。拡幅工事が終わった新設の第2セクション。見た目は綺麗だが路面はひどいもんだな。アスファルトの継ぎ目がバンピーで跳ねまくる。',
          },
        ],
      },
      { when: { at: 1460 }, say: [{ who: 'tachi', text: 'ハイポイントコーナーを通過した。ここからはきついダウンヒルの第3セクション。' }] },
      {
        when: { at: 1750 },
        say: [
          {
            who: 'tachi',
            text: 'この橋の手前でこのコースの最高速を記録する。橋を渡ればその先はきつい登りの第4セクション。一気に引き離してジ・エンドだ。',
          },
        ],
      },
      // ラフプレーで軽く当てたとき（長いので2回に分けて出す）
      {
        when: { event: 'rivalBump' },
        say: [
          { who: 'tachi', text: 'スピンさせるほど強くは押してない。相手の姿勢を一瞬崩してやるだけだ。', whole: true },
          { who: 'tachi', text: '悪く思うなよ。これぐらいあっちの世界では日常茶飯事だぜ。', whole: true },
        ],
      },
    ],
  },
};

/** ライバル以外で話す人（id → 名前と画像）。画像は public/ からのパス（例: 'characters/bunta.jpg'） */
export const CHARACTERS: Readonly<Record<string, { name: string; photo?: string }>> = {
  bunta: { name: '藤原文太' },
};
