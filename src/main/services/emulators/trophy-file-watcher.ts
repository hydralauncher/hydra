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
  skipSouvenirCapture = false,
}: StartTrophyFileWatcherOptions): TrophyFileWatcher => {
  let trophyFile: string | null = null;
  let lastModifiedAt = -1;
  let hasImportedExistingUnlocks = false;
  let hasSeenChange = false;
  let nextCatalogueAttemptAt = 0;
  let inFlightRead: Promise<void> | null = null;

  const readTrophies = async (isFinalRead: boolean) => {
    if (!HydraApi.isLoggedIn()) return;

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
    if (!unlockedTrophies) return;

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

    hasImportedExistingUnlocks = true;
    lastModifiedAt = stats.mtimeMs;
  };

  const runRead = (isFinalRead: boolean) => {
    inFlightRead = readTrophies(isFinalRead)
      .catch((error) => {
        achievementsLogger.error(
          `Failed to read ${label} trophies`,
          gameKey,
          error
        );
      })
      .finally(() => {
        inFlightRead = null;
      });
    return inFlightRead;
  };

  const timer = setInterval(() => {
    if (inFlightRead === null) void runRead(false);
  }, INTERVALS.achievementWatcher);
  timer.unref?.();

  return {
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
