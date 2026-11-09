import { promises as fs } from "node:fs";

import type { Game } from "@types";
import { platformToSystem } from "@shared";

import { INTERVALS } from "@main/constants";
import { gamesSublevel } from "@main/level";
import { AchievementMemoryStore } from "../achievements/achievement-memory-store";
import { getGameAchievementData } from "../achievements/get-game-achievement-data";
import { mergeAchievements } from "../achievements/merge-achievements";
import { HydraApi } from "../hydra-api";
import { prepareLinuxGameCaptureSession } from "../linux-game-capture-session";
import { achievementsLogger } from "../logger";
import { getEmulatorConfig } from "./emulators-repository";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";
import {
  parseUnlockedTrophies,
  resolveShadps4TrophyFile,
} from "./shadps4-trophies";

const CATALOGUE_RETRY_INTERVAL_MS = 30_000;

export interface Shadps4TrophyWatcher {
  finish: () => Promise<void>;
}

interface StartShadps4TrophyWatcherOptions {
  gameKey: string;
  executablePath: string;
  discPath: string;
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

export const startShadps4TrophyWatcher = ({
  gameKey,
  executablePath,
  discPath,
}: StartShadps4TrophyWatcherOptions): Shadps4TrophyWatcher => {
  let trophyFile: string | null = null;
  let lastModifiedAt = -1;
  let hasImportedExistingUnlocks = false;
  let hasPreparedCapture = false;
  let nextCatalogueAttemptAt = 0;
  let inFlightRead: Promise<void> | null = null;

  const readTrophies = async (isFinalRead: boolean) => {
    if (!HydraApi.isLoggedIn()) return;

    trophyFile ??= await resolveShadps4TrophyFile(executablePath, discPath);
    if (!trophyFile) return;

    const stats = await fs.stat(trophyFile).catch(() => null);
    if (!stats || stats.mtimeMs === lastModifiedAt) return;

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    if (!hasPreparedCapture && !isFinalRead) {
      hasPreparedCapture = true;
      prepareCaptureOnce(gameKey, game).catch((error) => {
        achievementsLogger.warn(
          "Failed to prepare shadPS4 trophy capture",
          gameKey,
          error
        );
      });
    }

    const contents = await fs.readFile(trophyFile, "utf8").catch(() => null);
    const unlockedTrophies = contents ? parseUnlockedTrophies(contents) : null;
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
    lastModifiedAt = stats.mtimeMs;
  };

  const runRead = (isFinalRead: boolean) => {
    inFlightRead = readTrophies(isFinalRead)
      .catch((error) => {
        achievementsLogger.error(
          "Failed to read shadPS4 trophies",
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
          "No shadPS4 trophy file for this session",
          gameKey
        );
      }
    },
  };
};

export const removeShadps4TrophyFile = async (game: Game): Promise<void> => {
  if (platformToSystem(game.platform) !== "ps4") return;

  const discPath = game.selectedDiscPath ?? game.discs?.[0]?.path;
  const { executablePath } = await getEmulatorConfig("ps4");
  if (!discPath || !executablePath) return;

  const trophyFile = await resolveShadps4TrophyFile(executablePath, discPath);
  if (trophyFile) await fs.rm(trophyFile, { force: true });
};
