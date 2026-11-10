import type { Game, UnlockedAchievement } from "@types";

import { INTERVALS } from "@main/constants";
import { gamesSublevel } from "@main/level";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import { mergeAchievements } from "../achievements/merge-achievements";
import { HydraApi } from "../hydra-api";
import { prepareLinuxGameCaptureSession } from "../linux-game-capture-session";
import { achievementsLogger } from "../logger";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";

const CATALOGUE_RETRY_INTERVAL_MS = 30_000;

export interface EmulatorTrophySnapshot {
  version: string;
  read: () => Promise<UnlockedAchievement[] | null>;
}

export interface EmulatorTrophyWatcher {
  finish: () => Promise<void>;
}

interface StartEmulatorTrophyWatcherOptions {
  gameKey: string;
  emulatorName: string;
  snapshot: (game: Game) => Promise<EmulatorTrophySnapshot | null>;
}

const hasTrophyCatalogue = async (game: Game): Promise<boolean> => {
  const cached = AchievementMemoryStore.get(game.shop, game.objectId);
  if (cached?.achievements.length) return true;

  const catalogue = await getGameAchievementData(
    game.objectId,
    game.shop,
    false
  );
  return catalogue.length > 0;
};

const prepareCaptureOnce = async (gameKey: string, game: Game) => {
  const tracking = await loadEmulatorAchievementTracking();
  if (tracking.souvenirs && game.remoteId) {
    await prepareLinuxGameCaptureSession(gameKey);
  }
};

export const startEmulatorTrophyWatcher = ({
  gameKey,
  emulatorName,
  snapshot,
}: StartEmulatorTrophyWatcherOptions): EmulatorTrophyWatcher => {
  let lastVersion: string | null = null;
  let hasFoundTrophies = false;
  let hasImportedExistingUnlocks = false;
  let hasPreparedCapture = false;
  let nextCatalogueAttemptAt = 0;
  let inFlightRead: Promise<void> | null = null;

  const readTrophies = async (isFinalRead: boolean) => {
    if (!HydraApi.isLoggedIn()) return;

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    const current = await snapshot(game);
    if (!current || current.version === lastVersion) return;
    hasFoundTrophies = true;

    if (!hasPreparedCapture && !isFinalRead) {
      hasPreparedCapture = true;
      prepareCaptureOnce(gameKey, game).catch((error) => {
        achievementsLogger.warn(
          `Failed to prepare ${emulatorName} trophy capture`,
          gameKey,
          error
        );
      });
    }

    const unlockedTrophies = await current.read();
    if (!unlockedTrophies) return;

    if (unlockedTrophies.length > 0) {
      if (!isFinalRead && Date.now() < nextCatalogueAttemptAt) return;

      if (!(await hasTrophyCatalogue(game))) {
        nextCatalogueAttemptAt = Date.now() + CATALOGUE_RETRY_INTERVAL_MS;
        return;
      }

      await mergeAchievements(
        game,
        unlockedTrophies,
        hasImportedExistingUnlocks,
        { skipSouvenirCapture: isFinalRead, alwaysUpdateInterface: true }
      );
    }

    hasImportedExistingUnlocks = true;
    lastVersion = current.version;
  };

  const runRead = (isFinalRead: boolean) => {
    inFlightRead = readTrophies(isFinalRead)
      .catch((error) => {
        achievementsLogger.error(
          `Failed to read ${emulatorName} trophies`,
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

      if (!hasFoundTrophies && HydraApi.isLoggedIn()) {
        achievementsLogger.warn(
          `No ${emulatorName} trophy file for this session`,
          gameKey
        );
      }
    },
  };
};
