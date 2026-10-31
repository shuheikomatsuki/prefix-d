import { courseKey } from '../map/courseRevision';
import { MAPS } from '../map/maps';
import type { MapDefinition } from '../map/tilemap';
import { type SubmitResult, mergeBoards } from '../net/leaderboard';
import { type LeaderboardClient, myEntryId, playerId, uploadedTotal } from '../net/leaderboardClient';
import type { GhostData } from '../race/ghost';
import { loadRecord } from '../race/records';
import { VEHICLE_PRESETS } from '../sim/vehicle';
import { courseProfile } from '../ui/courseInfo';
import { loadPlayerName } from '../ui/onlinePanel';
import { ALL_CARS, RankingPanel } from '../ui/rankingPanel';

/** ランキングで選んだ人のゴースト */
export interface RankedGhost {
  name: string;
  total: number;
  ghost: GhostData;
}

/** タイムアタックのランキング（自己ベストを送る・一覧を見る・上位の人のゴーストと対戦する） */
export class Ranking {
  readonly panel: RankingPanel;
  private readonly raceMaps = MAPS.filter((m) => m.race);

  constructor(
    /** ランキングのサーバー（設定されていなければ null） */
    private readonly board: LeaderboardClient | null,
    handlers: {
      /** 一覧で選んだ人のゴーストと、そのコース・車でタイムアタックする */
      onRace: (course: string, car: string, ghost: RankedGhost) => void;
      onOpenChange: (open: boolean) => void;
    },
  ) {
    this.panel = new RankingPanel(
      this.raceMaps.map((m) => {
        const p = courseProfile(m);
        return { id: m.id, label: m.name, note: p.kind === 'free' ? undefined : `${(p.length / 1000).toFixed(1)}km・${p.kind === 'loop' ? `${p.laps}周` : p.kind === 'roundtrip' ? '往復' : '一本道'}` };
      }),
      VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label })),
      {
        load: async (course, car) => {
          const def = MAPS.find((m) => m.id === course);
          if (!def || !board) return { entries: [], mine: new Set<string>() };
          // ランキングはコースの形の版ごと（コースを直す前の記録は出さない）
          const key = courseKey(def);
          const cars = car === ALL_CARS ? VEHICLE_PRESETS.map((v) => v.id) : [car];
          const boards = await Promise.all(
            cars.map(async (id) => {
              // 前に走った自己ベストも、名前を入れた後なら送る
              await this.uploadBest(def, id).catch(() => null);
              return { car: id, entries: await board.list(key, id) };
            }),
          );
          const mine = new Set(cars.map((id) => myEntryId(key, id)).filter((id): id is string => id !== null));
          return { entries: mergeBoards(boards), mine };
        },
        onRace: async (course, entry) => {
          const def = MAPS.find((m) => m.id === course);
          if (!def || !board) return;
          const ghost = await board.ghost(courseKey(def), entry.car, entry.id);
          handlers.onRace(course, entry.car, { name: entry.name, total: entry.total, ghost });
        },
        onOpenChange: handlers.onOpenChange,
      },
    );
  }

  /** ランキングのサーバーがあるか */
  get available(): boolean {
    return this.board !== null;
  }

  /** まだランキングに送っていない自己ベストを送る（名前を入れていなければ送らない） */
  async uploadBest(def: MapDefinition, car: string): Promise<SubmitResult | null> {
    const name = loadPlayerName().trim();
    const key = courseKey(def);
    const record = loadRecord(key, car);
    if (!this.board || !name || !record || record.ghost.length === 0 || uploadedTotal(key, car) === record.total) return null;
    return this.board.submit(key, car, { player: playerId(), name, total: record.total, laps: record.laps, ghost: record.ghost });
  }

  /** 一覧を開く（いまのコースがレース用ならそのコース、でなければ最初のレース用のコース） */
  open(current: MapDefinition): void {
    this.panel.open(current.race ? current.id : this.raceMaps[0].id, ALL_CARS);
  }
}
