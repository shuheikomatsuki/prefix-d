/** クラクションの音を鳴らす相手（SoundSystem のうち使うところだけ） */
export interface HornSound {
  horn(id: number | 'me', on: boolean, volume?: number): void;
  setHornVolume(id: number, volume: number): void;
}

/** クラクションの音が届く距離 [m]（遠い車ほど小さく聞こえる） */
export const HORN_RANGE = 160;
/** 他の人のクラクションの「止める」が届かなかったときに止めるまでの時間 [ms] */
export const HORN_MAX_MS = 4000;

/** 他の人のクラクションの大きさ: 遠いほど小さく、HORN_RANGE 以上離れると聞こえない */
export function hornVolume(distance: number): number {
  return Math.max(0, 1 - distance / HORN_RANGE);
}

/**
 * クラクション: 押している間だけ鳴らし、部屋の人にも知らせる。部屋の人のクラクションは、距離に合わせた大きさで鳴らす
 */
export class Horns {
  /** キーボード（G）と画面のボタン */
  readonly input = { key: false, touch: false };
  private on = false;
  private readonly remoteTimers = new Map<number, number>();

  constructor(
    private readonly sound: HornSound,
    /** 自分のクラクションを部屋に知らせる */
    private readonly send: (on: boolean) => void,
    /** 部屋の人の車までの距離 [m]（分からなければ null） */
    private readonly distanceTo: (id: number) => number | null,
  ) {}

  /** 押しているかが変わったら、鳴らす・止める（毎ステップ） */
  update(): void {
    const on = this.input.key || this.input.touch;
    if (on === this.on) return;
    this.on = on;
    this.sound.horn('me', on);
    this.send(on);
  }

  /** 部屋の人がクラクションを鳴らした・止めた */
  remote(id: number, on: boolean): void {
    window.clearTimeout(this.remoteTimers.get(id));
    if (!on) {
      this.remoteTimers.delete(id);
      this.sound.horn(id, false);
      return;
    }
    this.sound.horn(id, true, this.volumeOf(id));
    this.remoteTimers.set(
      id,
      window.setTimeout(() => {
        this.remoteTimers.delete(id);
        this.sound.horn(id, false);
      }, HORN_MAX_MS),
    );
  }

  /** 部屋の人のクラクションをすべて止める（通信が切れたとき） */
  stopRemote(): void {
    for (const id of [...this.remoteTimers.keys()]) this.remote(id, false);
  }

  /** 鳴らしている間に近づいたり離れたりしたら、大きさを変える（毎フレーム） */
  updateVolumes(): void {
    for (const id of this.remoteTimers.keys()) this.sound.setHornVolume(id, this.volumeOf(id));
  }

  private volumeOf(id: number): number {
    return hornVolume(this.distanceTo(id) ?? HORN_RANGE);
  }
}
