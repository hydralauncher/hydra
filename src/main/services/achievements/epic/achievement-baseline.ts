import type { UnlockedAchievement } from "@types";
import type { EpicAchievementSource } from "./achievement-state";

type FileBaseline =
  | { kind: "pending"; sinceMs: number }
  | { kind: "valid"; historicalIds: Set<string> };
const MILLISECONDS_PER_SECOND = 1000;

export interface ClassifiedEpicAchievements {
  historical: UnlockedAchievement[];
  live: UnlockedAchievement[];
}

/** Keep a successful file baseline even if a later read fails. */
export class EpicAchievementBaselineTracker {
  private readonly files = new Map<string, Map<string, FileBaseline>>();

  constructor(private startedAtMs = Date.now()) {}

  public observe(
    gameKey: string,
    filePath: string,
    source: EpicAchievementSource,
    unlocks: UnlockedAchievement[] | null,
    initialSync: boolean,
    observedAtMs: number
  ): ClassifiedEpicAchievements | null {
    const gameFiles =
      this.files.get(gameKey) ?? new Map<string, FileBaseline>();
    const previous = gameFiles.get(filePath);

    if (unlocks === null) {
      if (!previous) {
        gameFiles.set(filePath, { kind: "pending", sinceMs: observedAtMs });
        this.files.set(gameKey, gameFiles);
      }
      return null;
    }

    let historicalIds: Set<string>;
    if (previous?.kind === "valid") {
      historicalIds = previous.historicalIds;
    } else if (previous?.kind === "pending") {
      // JSON times have one-second precision. Treat the boundary second as live.
      const cutoffMs =
        Math.floor(previous.sinceMs / MILLISECONDS_PER_SECOND) *
        MILLISECONDS_PER_SECOND;
      historicalIds = new Set(
        source === "nemirtingas"
          ? unlocks
              .filter((unlock) => unlock.unlockTime < cutoffMs)
              .map((unlock) => unlock.name)
          : unlocks.map((unlock) => unlock.name)
      );
    } else if (initialSync || source === "alan-wake-2") {
      historicalIds = new Set(unlocks.map((unlock) => unlock.name));
    } else {
      const cutoffMs =
        Math.floor(this.startedAtMs / MILLISECONDS_PER_SECOND) *
        MILLISECONDS_PER_SECOND;
      historicalIds = new Set(
        unlocks
          .filter((unlock) => unlock.unlockTime < cutoffMs)
          .map((unlock) => unlock.name)
      );
    }

    gameFiles.set(filePath, { kind: "valid", historicalIds });
    this.files.set(gameKey, gameFiles);

    return {
      historical: unlocks.filter((unlock) => historicalIds.has(unlock.name)),
      live: unlocks.filter((unlock) => !historicalIds.has(unlock.name)),
    };
  }

  public markReset(gameKey: string, filePaths: string[]) {
    this.files.set(
      gameKey,
      new Map(
        filePaths.map((filePath) => [
          filePath,
          { kind: "valid", historicalIds: new Set<string>() },
        ])
      )
    );
  }

  public clear(startedAtMs = Date.now()) {
    this.files.clear();
    this.startedAtMs = startedAtMs;
  }
}
