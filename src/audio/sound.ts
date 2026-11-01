/**
 * 効果音。音声ファイルを使わず Web Audio API で合成する（アセットのライセンス管理が不要）。
 * ブラウザの制約で、最初のキー入力・クリックの後でないと音を鳴らせない。
 */

/** 疑似的なギアの切り替わり速度 [m/s] */
const GEAR_SHIFT_SPEEDS = [0, 7, 14, 21, 28, 38, 48];

export interface EngineTone {
  gear: number;
  /** 0..1 の回転数 */
  rpm: number;
  frequency: number;
  cutoff: number;
  gain: number;
}

/** 速度とアクセルからエンジン音のパラメータを求める（ギアが上がると回転数が下がる） */
export function engineTone(speed: number, throttle: number): EngineTone {
  const v = Math.abs(speed);
  let gear = 0;
  while (gear + 1 < GEAR_SHIFT_SPEEDS.length && v >= GEAR_SHIFT_SPEEDS[gear + 1]) gear++;
  const low = GEAR_SHIFT_SPEEDS[gear];
  const high = GEAR_SHIFT_SPEEDS[gear + 1] ?? low + 8;
  const inGear = Math.min(1, (v - low) / (high - low));
  // シフトアップ直後は回転数が少し落ちたところから上がっていく
  const rpm = gear === 0 ? inGear * 0.8 + throttle * 0.15 : 0.35 + inGear * 0.6 + throttle * 0.05;
  return {
    gear,
    rpm,
    frequency: 38 + rpm * 90,
    cutoff: 350 + throttle * 900 + rpm * 500,
    gain: 0.05 + throttle * 0.05 + rpm * 0.02,
  };
}

const STORAGE_KEY = 'car-game:muted';
/** クラクションのいちばん大きな音量 */
const HORN_GAIN = 0.16;

function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // 保存できなくても動作には影響しない
  }
}

interface Voices {
  ctx: AudioContext;
  master: GainNode;
  engineOsc: OscillatorNode;
  engineSub: OscillatorNode;
  engineFilter: BiquadFilterNode;
  engineGain: GainNode;
  screechGain: GainNode;
  noise: AudioBuffer;
}

export class SoundSystem {
  private voices: Voices | null = null;
  /** 鳴っているクラクション（自分は 'me'、他の人は id） */
  private readonly horns = new Map<string | number, { gain: GainNode; oscs: OscillatorNode[] }>();
  private readonly effects = new Map<string, Promise<AudioBuffer | null>>();
  private muted = loadMuted();

  get isMuted(): boolean {
    return this.muted;
  }

  /** start() の後に使える AudioContext（BGM も同じものに流す） */
  get context(): AudioContext | null {
    return this.voices?.ctx ?? null;
  }

  /** ユーザー操作のイベント内で呼ぶ。2回目以降は何もしない */
  start(): void {
    if (this.voices) {
      // iOS では音声読み上げや着信の後に 'interrupted' になることがあるので、running 以外は再開を試みる
      if (this.voices.ctx.state !== 'running') void this.voices.ctx.resume().catch(() => {});
      return;
    }
    // iPhone はマナーモード（消音スイッチ）だと Web Audio の音が消える（読み上げの声は鳴る）。
    // 再生用の音声セッションにすると、動画アプリと同じく消音スイッチに関係なく鳴る（iOS 17 以降）
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = 'playback';
      } catch {
        // 対応していなければそのまま
      }
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();

    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 1;
    master.connect(ctx.destination);

    // エンジン: のこぎり波 + 1オクターブ下の矩形波をローパスに通す
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.Q.value = 2;
    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineFilter.connect(engineGain).connect(master);
    const engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    const engineSub = ctx.createOscillator();
    engineSub.type = 'square';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    engineOsc.connect(engineFilter);
    engineSub.connect(subGain).connect(engineFilter);
    engineOsc.start();
    engineSub.start();

    // タイヤのスキール音: ノイズをバンドパスに通す
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = noise;
    screechSrc.loop = true;
    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1800;
    screechFilter.Q.value = 4;
    const screechGain = ctx.createGain();
    screechGain.gain.value = 0;
    screechSrc.connect(screechFilter).connect(screechGain).connect(master);
    screechSrc.start();

    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    this.voices = { ctx, master, engineOsc, engineSub, engineFilter, engineGain, screechGain, noise };
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    saveMuted(this.muted);
    if (this.voices) {
      this.voices.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.voices.ctx.currentTime, 0.05);
    }
    return this.muted;
  }

  /** 毎フレーム呼ぶ */
  update(speed: number, throttle: number, lateralSpeed: number, braking: boolean, understeer = 0): void {
    const v = this.voices;
    if (!v) return;
    const t = v.ctx.currentTime;
    const tone = engineTone(speed, throttle);
    v.engineOsc.frequency.setTargetAtTime(tone.frequency, t, 0.05);
    v.engineSub.frequency.setTargetAtTime(tone.frequency / 2, t, 0.05);
    v.engineFilter.frequency.setTargetAtTime(tone.cutoff, t, 0.08);
    v.engineGain.gain.setTargetAtTime(tone.gain, t, 0.1);

    // 横滑り、前のタイヤの滑り（アンダーステア）、または速度が出ている状態での急ブレーキで鳴らす
    const slip = Math.max(0, Math.abs(lateralSpeed) - 1.5) / 4 + (speed > 5 ? understeer * 0.8 : 0);
    const brakeSkid = braking && speed > 8 ? 0.4 : 0;
    const screech = Math.min(1, slip + brakeSkid) * 0.12;
    v.screechGain.gain.setTargetAtTime(screech, t, 0.05);
  }

  /** 衝突音。strength は衝突の強さ [m/s] */
  impact(strength: number): void {
    const v = this.voices;
    if (!v) return;
    const t = v.ctx.currentTime;
    const src = v.ctx.createBufferSource();
    src.buffer = v.noise;
    const filter = v.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300 + Math.min(strength, 15) * 60;
    const gain = v.ctx.createGain();
    const peak = Math.min(1, strength / 12) * 0.7;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(filter).connect(gain).connect(v.master);
    src.start(t, Math.random() * 0.5, 0.4);
  }

  /**
   * セリフの効果音。public/sounds/<name>.mp3 があればそれを鳴らし、無ければ合成した音（'slap' のみ）を鳴らす。
   * 読み込んだ音は覚えておく
   */
  effect(name: string): void {
    const v = this.voices;
    if (!v) return;
    let loading = this.effects.get(name);
    if (!loading) {
      loading = fetch(`${import.meta.env.BASE_URL}sounds/${encodeURIComponent(name)}.mp3`)
        .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
        .then((data) => v.ctx.decodeAudioData(data))
        .catch(() => null);
      this.effects.set(name, loading);
    }
    void loading.then((buffer) => {
      if (buffer) {
        const src = v.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(v.master);
        src.start();
      } else if (name === 'slap') {
        this.slap();
      }
    });
  }

  /** 平手打ちの音（短いノイズの破裂音と、低い「パン」） */
  private slap(): void {
    const v = this.voices;
    if (!v) return;
    const t = v.ctx.currentTime;
    const src = v.ctx.createBufferSource();
    src.buffer = v.noise;
    const filter = v.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2200;
    filter.Q.value = 0.8;
    const gain = v.ctx.createGain();
    gain.gain.setValueAtTime(1.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(filter).connect(gain).connect(v.master);
    src.start(t, Math.random() * 0.5, 0.15);
    const thump = v.ctx.createOscillator();
    thump.frequency.setValueAtTime(220, t);
    thump.frequency.exponentialRampToValueAtTime(80, t + 0.08);
    const tg = v.ctx.createGain();
    tg.gain.setValueAtTime(0.7, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    thump.connect(tg).connect(v.master);
    thump.start(t);
    thump.stop(t + 0.12);
  }

  /**
   * クラクションを鳴らし始める・止める。key ごとに1つ鳴る（自分は 'me'、他の人は id）。
   * volume は 0〜1（遠くの車ほど小さく）
   */
  horn(key: string | number, on: boolean, volume = 1): void {
    const v = this.voices;
    if (!v) return;
    const t = v.ctx.currentTime;
    const playing = this.horns.get(key);
    if (!on) {
      if (!playing) return;
      this.horns.delete(key);
      playing.gain.gain.cancelScheduledValues(t);
      playing.gain.gain.setTargetAtTime(0, t, 0.03);
      for (const o of playing.oscs) o.stop(t + 0.2);
      return;
    }
    // 遠くて聞こえない車も、近づいたら聞こえるように鳴らし始めておく
    if (playing) return;
    // 2つの音程（ミとソくらい）を重ねた、乗用車のホーンらしい音
    const filter = v.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    const gain = v.ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(HORN_GAIN * Math.min(1, volume), t + 0.02);
    filter.connect(gain).connect(v.master);
    const oscs = [415, 523].map((f) => {
      const o = v.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(filter);
      o.start(t);
      return o;
    });
    this.horns.set(key, { gain, oscs });
  }

  /** 鳴っているクラクションの大きさを変える（鳴っていなければ何もしない） */
  setHornVolume(key: string | number, volume: number): void {
    const v = this.voices;
    const playing = this.horns.get(key);
    if (!v || !playing) return;
    playing.gain.gain.setTargetAtTime(HORN_GAIN * Math.min(1, Math.max(0, volume)), v.ctx.currentTime, 0.05);
  }

  /** 合図の電子音（カウントダウン・ラップ）。high は高い音（スタート・ゴール） */
  beep(high = false): void {
    const v = this.voices;
    if (!v) return;
    const t = v.ctx.currentTime;
    const osc = v.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = high ? 1320 : 660;
    const gain = v.ctx.createGain();
    const length = high ? 0.5 : 0.18;
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + length);
    osc.connect(gain).connect(v.master);
    osc.start(t);
    osc.stop(t + length);
  }
}
