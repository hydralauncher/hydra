import { promises as fs } from "node:fs";

import type { Game, SteamAchievement, UnlockedAchievement } from "@types";

import { INTERVALS } from "@main/constants";
import { gamesSublevel } from "@main/level";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import { mergeAchievements } from "../achievements/merge-achievements";
import { HydraApi } from "../hydra-api";
import { achievementsLogger } from "../logger";

const CATALOGUE_RETRY_INTERVAL_MS = 30_000;

export interface TrophyFileWatcher {
  finish: () => Promise<void>;
  /**
   * After the achievements were reset while the game runs: what the trophy
   * file has now is ignored for the rest of the session (the game may write
   * it back from memory), and only trophies earned from here on count.
   * Resolves with the ignored trophy names.
   */
  forget: () => Promise<string[]>;
  /** Trophies to leave out of every read, such as a reset not cleaned yet. */
  ignore: (names: string[]) => void;
}

export interface StartTrophyFileWatcherOptions {
  gameKey: string;
  label: string;
  resolveFile: () => Promise<string | null>;
  readUnlocks: (file: string) => Promise<UnlockedAchievement[] | null>;
  completeUnlocks?: (
    unlocks: UnlockedAchievement[],
    catalogue: SteamAchievement[],
    game: Game
  ) => UnlockedAchievement[];
  onFirstChange?: (game: Game) => void;
  /** Clears what `readUnlocks` keeps between reads, at the reset. */
  onForget?: (file: string | null) => Promise<void>;
  skipSouvenirCapture?: boolean;
}

const loadTrophyCatalogue = async (game: Game): Promise<SteamAchievement[]> => {
  const cached = AchievementMemoryStore.get(game.shop, game.objectId);
  if (cached?.achievements.length) return cached.achievements;

  return getGameAchievementData(game.objectId, game.shop, false);
};

export const startTrophyFileWatcher = ({
  gameKey,
  label,
  resolveFile,
  readUnlocks,
  completeUnlocks,
  onFirstChange,
  onForget,
  skipSouvenirCapture = false,
}: StartTrophyFileWatcherOptions): TrophyFileWatcher => {
  let trophyFile: string | null = null;
  let lastModifiedAt = -1;
  let hasImportedExistingUnlocks = false;
  let hasSeenChange = false;
  let nextCatalogueAttemptAt = 0;
  let inFlightRead: Promise<void> | null = null;
  // Bumped by forget(), so a read that started before it changes nothing.
  let generation = 0;
  let ignored = new Set<string>();

  const readTrophies = async (isFinalRead: boolean) => {
    if (!HydraApi.isLoggedIn()) return;
    const startedAt = generation;
    const isStale = () => generation !== startedAt;

    trophyFile ??= await resolveFile();
    if (!trophyFile) return;

    const stats = await fs.stat(trophyFile).catch(() => null);
    if (!stats) {
      hasImportedExistingUnlocks = true;
      return;
    }
    if (stats.mtimeMs === lastModifiedAt) return;

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    if (!hasSeenChange && !isFinalRead) {
      hasSeenChange = true;
      onFirstChange?.(game);
    }

    let unlockedTrophies = await readUnlocks(trophyFile);
    if (!unlockedTrophies || isStale()) return;
    unlockedTrophies = unlockedTrophies.filter(
      (unlock) => !ignored.has(unlock.name.toUpperCase())
    );

    if (unlockedTrophies.length > 0) {
      if (!isFinalRead && Date.now() < nextCatalogueAttemptAt) return;

      const catalogue = await loadTrophyCatalogue(game);
      if (!catalogue.length) {
        nextCatalogueAttemptAt = Date.now() + CATALOGUE_RETRY_INTERVAL_MS;
        return;
      }

      if (completeUnlocks) {
        unlockedTrophies = completeUnlocks(unlockedTrophies, catalogue, game);
      }

      if (isStale()) return;
      if (unlockedTrophies.length > 0) {
        await mergeAchievements(
          game,
          unlockedTrophies,
          hasImportedExistingUnlocks,
          {
            skipSouvenirCapture: skipSouvenirCapture || isFinalRead,
            alwaysUpdateInterface: true,
          }
        );
      }
    }

    if (isStale()) return;
    hasImportedExistingUnlocks = true;
    lastModifiedAt = stats.mtimeMs;
  };

  // Reads and resets take turns: the interval starts a read only when nothing
  // is in flight, and a reset holds the slot until it is done.
  const occupy = <T>(work: Promise<T>) => {
    const slot = work.then(
      () => undefined,
      () => undefined
    );
    inFlightRead = slot;
    void slot.finally(() => {
      if (inFlightRead === slot) inFlightRead = null;
    });
    return work;
  };

  const runRead = (isFinalRead: boolean) =>
    occupy(
      readTrophies(isFinalRead).catch((error) => {
        achievementsLogger.error(
          `Failed to read ${label} trophies`,
          gameKey,
          error
        );
      })
    );

  const timer = setInterval(() => {
    if (inFlightRead === null) void runRead(false);
  }, INTERVALS.achievementWatcher);
  timer.unref?.();

  const forgetNow = async (previous: Promise<void> | null) => {
    await previous;
    trophyFile ??= await resolveFile();
    await onForget?.(trophyFile);
    const current = trophyFile
      ? await readUnlocks(trophyFile).catch(() => null)
      : null;
    ignored = new Set([
      ...ignored,
      ...(current ?? []).map((unlock) => unlock.name.toUpperCase()),
    ]);
    lastModifiedAt = -1;
    hasImportedExistingUnlocks = true;
    return [...ignored];
  };

  return {
    ignore: (names) => {
      ignored = new Set([
        ...ignored,
        ...names.map((name) => name.toUpperCase()),
      ]);
    },
    forget: () => {
      generation += 1;
      return occupy(forgetNow(inFlightRead));
    },
    finish: async () => {
      clearInterval(timer);
      await inFlightRead;
      await runRead(true);

      if (!trophyFile && HydraApi.isLoggedIn()) {
        achievementsLogger.warn(
          `No ${label} trophy file for this session`,
          gameKey
        );
      }
    },
  };
};
