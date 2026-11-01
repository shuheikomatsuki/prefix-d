# バトルのセリフの書き方

セリフは `src/race/dialogueScript.ts` の `RIVAL_DIALOGUES` に書く。ライバルの id（`src/race/rivals.ts`）ごとに、次の5種類を書ける（いらないものは書かなくてよい）。

| 種類 | いつ出るか | 出し方 |
| --- | --- | --- |
| `intro` | スタート前（アクセルを押す前） | 画面の下に大きな枠。タップ・Enter・A ボタンで次へ |
| `race` | 走っている途中、条件を満たしたとき | 画面の下に小さな字幕（数秒で消える） |
| `win` | 自分が勝ったあと（結果の前） | 大きな枠 |
| `lose` | 自分が負けたあと | 大きな枠 |
| `draw` | 先行後追いの引き分けのあと（次の1本の前） | 大きな枠 |

- はじめは、**ライバルの得意なコースでバトルしたときだけ**出る。どのコースでも出したいときは `onlyHomeCourse: false`。
- このバトルでセリフを出す条件（例: 自分がハチロクのときだけ）は、ライバルごとの `when` に書く。

## 1つのセリフ

```ts
{ who: 'takumi', text: 'セリフ' }
```

`who` は話す人:

- ライバルの id（`'takumi'`、`'keisuke'` など）→ そのライバルの名前（と写真）
- `'player'` → 自分（オンラインで決めた名前、なければ「あなた」）
- `'sfx'` → 効果音の字幕（名前を出さず、黄色の斜体）。例: `{ who: 'sfx', text: 'バシィッ！！', sound: 'slap' }`
- `CHARACTERS` に書いた id（`'bunta'` など、ライバル以外の人）
- それ以外 → 書いた文字がそのまま名前になる

`text` の中の `\n` で改行する。

`sound` を書くと、そのセリフを出すときに効果音を鳴らす。`sound: 'slap'` なら `public/sounds/slap.mp3` を鳴らす（mp3 を置いていなければ、ゲームで合成した平手打ちの音）。ほかの名前でも、`public/sounds/<名前>.mp3` を置けば鳴る。

走っている途中の長いセリフは、文の切れ目で区切って順に出す。区切らずに1つの字幕で出したいときは `whole: true` を書く。

## 場面（intro / win / lose / draw）

```ts
intro: [
  // 上から順に見て、条件（when）に合う最初の場面を使う。when が無い場面はいつでも合う
  { when: { weather: 'rain' }, say: [{ who: 'takumi', text: '雨か……' }] },
  { say: [{ who: 'takumi', text: '……' }, { who: 'player', text: '行くぞ' }] },
],
```

先行後追いの2本目からの `intro` は、`when: { round: 2 }` のように本数を書いた場面だけが出る。

## 走っている途中のセリフ（race）

```ts
race: [
  { when: { at: 1200 }, say: [{ who: 'takumi', text: 'ここだ' }] },
  { when: { event: 'overtaken' }, say: [{ who: 'keisuke', text: 'なにっ！' }] },
  { when: { position: 'behind', gap: { max: 10 }, elapsed: { min: 60 } }, say: [...] },
  { when: { event: 'crash' }, say: [...], repeat: true },
],
```

- `when` に書いた条件を**すべて**満たしたときに出る。
- はじめは1回のバトルで1回だけ。`repeat: true` で何度でも出る（場所・出来事以外の条件は、満たさなくなってから再び満たしたとき）。
- 字幕が出ている間に次のセリフが来たら、順番を待つ。
- `oneAtATime: true` は、`say` のセリフを1回に1つずつ、書いた順に出す（最後まで出したら最初に戻る。`repeat: true` と一緒に使う）。
- `onlyWhenQuiet: true` は、ほかの字幕が出ている間は出さない（順番を待たずに、そのときは言わない）。コーナーごとのかけ声などに使う。

```ts
// コーナーに入るたびに、かけ声を順に1つずつ
{ when: { event: 'rivalCorner' }, repeat: true, oneAtATime: true, onlyWhenQuiet: true, say: [{ who: 'hoshino', text: 'どりゃー！！' }, { who: 'hoshino', text: 'ふりゃあぁー！' }] },
```

## 条件（when）に書けるもの

どれも書かなければ「なんでもよい」。

| 条件 | 意味 | 例 |
| --- | --- | --- |
| `playerCar` | 自分の車の id（複数は配列） | `'ae86'`、`['fd3s', 'evo']` |
| `rule` | バトルの方式 | `'side'`（横に並んで）、`'suddenDeath'`（先行後追い） |
| `playerLeads` | 先行後追いで自分が先行か | `true` / `false` |
| `round` | 先行後追いの何本目か | `2` |
| `weather` | 天気 | `'clear'`、`'rain'`、`'fog'` |
| `time` | 時間帯 | `'morning'`、`'day'`、`'night'` |

`race` だけで書けるもの:

| 条件 | 意味 | 例 |
| --- | --- | --- |
| `at` | スタートラインからこの距離 [m] の場所を通ったとき（周回コースは周ごと） | `1200` |
| `lap` | 何周目か | `2` |
| `event` | 出来事: `'overtake'`（自分が抜いた）、`'overtakeInside'`（コーナーでインから抜いた）、`'overtaken'`（抜かれた）、`'crash'`（自分が壁に強くぶつかった）、`'rivalWide'`（ライバルがコーナーで外へはみ出した）、`'rivalBump'`（ラフプレーでライバルにぶつけられた）、`'rivalCorner'`（ライバルがコーナーに入った。同じコーナーでは1回）。配列ならどれかが起きたとき | `'overtaken'`、`['rivalWide', 'overtakeInside']` |
| `position` | 自分がライバルの前（`'ahead'`）か後ろ（`'behind'`）か | `'behind'` |
| `gap` | 自分とライバルの差 [m] | `{ max: 10 }`、`{ min: 50 }` |
| `speed` | 自分の速さ [km/h] | `{ min: 150 }` |
| `elapsed` | スタートしてからの時間 [秒] | `{ min: 60, max: 90 }` |
| `progress` | レース全体のうち自分が進んだ割合（0 = スタート、1 = ゴール） | 終盤なら `{ min: 0.7 }` |

## 場所（at）の調べ方

ゲームを `?debug` を付けて開く（例: `https://shuheikomatsuki.github.io/prefix-d/?debug`）と、走っている間、画面の左下に「1周目 1234m」のように今の場所が出る。セリフを出したいところで止まって、その数字を `at` に書く。

## 画像

ライバルの画像は `src/race/rivals.ts` の `photo`、ライバル以外の人は `CHARACTERS` の `photo` に、`public/` からのパスを書く（例: `'rivals/takumi.jpg'`）。書けば、場面の枠の左に画像が出る（無ければ名前の頭文字）。
