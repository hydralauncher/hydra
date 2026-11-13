import { promises as fs } from "node:fs";

import type { Game } from "@types";

import { INTERVALS } from "@main/constants";
import { gamesSublevel } from "@main/level";
import { mergeAchievements } from "../achievements/merge-achievements";
import { HydraApi } from "../hydra-api";
import { prepareLinuxGameCaptureSession } from "../linux-game-capture-session";
import { achievementsLogger } from "../logger";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";
import {
  loadRpcs3TrophyCatalogue,
  readRpcs3TrophySourceUnlocks,
  resolveRpcs3TrophySources,
  type Rpcs3TrophySources,
} from "./rpcs3-trophy-sources";
import { listRpcs3TropUsrFiles } from "./rpcs3-trophies";

export interface Rpcs3TrophyWatcher {
  finish: () => Promise<void>;
}

interface StartRpcs3TrophyWatcherOptions {
  gameKey: string;
  discPath: string;
}

const prepareCaptureOnce = async (gameKey: string, game: Game) => {
  const tracking = await loadEmulatorAchievementTracking();
  if (tracking.souvenirs && game.remoteId) {
    await prepareLinuxGameCaptureSession(gameKey);
  }
};

const readFilesVersion = async (files: string[]) => {
  const stats = await Promise.all(
    files.map((file) => fs.stat(file).catch(() => null))
  );
  return files
    .map((file, index) => {
      const fileStats = stats[index];
      return `${file}:${fileStats?.mtimeMs ?? 0}:${fileStats?.size ?? 0}`;
    })
    .join("|");
};

export const startRpcs3TrophyWatcher = ({
  gameKey,
  discPath,
}: StartRpcs3TrophyWatcherOptions): Rpcs3TrophyWatcher => {
  let sources: Rpcs3TrophySources | null = null;
  let lastVersion: string | null = null;
  let hasFoundTrophies = false;
  let hasImportedExistingUnlocks = false;
  let hasPreparedCapture = false;
  let inFlightRead: Promise<void> | null = null;

  const readTrophies = async (isFinalRead: boolean) => {
    if (!HydraApi.isLoggedIn()) return;

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    const catalogue = await loadRpcs3TrophyCatalogue(game, isFinalRead);
    if (!catalogue.length) return;
    sources ??= await resolveRpcs3TrophySources(game, catalogue, discPath);
    if (!sources) return;

    const files = await listRpcs3TropUsrFiles(
      sources.homeRoots,
      sources.npCommIds
    );
    if (!files.length) return;

    const version = await readFilesVersion(files);
    if (version === lastVersion) return;
    hasFoundTrophies = true;

    if (!hasPreparedCapture && !isFinalRead) {
      hasPreparedCapture = true;
      prepareCaptureOnce(gameKey, game).catch((error) => {
        achievementsLogger.warn(
          "Failed to prepare RPCS3 trophy capture",
          gameKey,
          error
        );
      });
    }

    const unlockedTrophies = await readRpcs3TrophySourceUnlocks(
      files,
      sources,
      catalogue
    );
    if (!unlockedTrophies) return;

    if (unlockedTrophies.length > 0) {
      await mergeAchievements(
        game,
        unlockedTrophies,
        hasImportedExistingUnlocks,
        { skipSouvenirCapture: isFinalRead, alwaysUpdateInterface: true }
      );
    }

    hasImportedExistingUnlocks = true;
    lastVersion = version;
  };

  const runRead = (isFinalRead: boolean) => {
    inFlightRead = readTrophies(isFinalRead)
      .catch((error) => {
        achievementsLogger.error(
          "Failed to read RPCS3 trophies",
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
          "No RPCS3 trophy file for this session",
          gameKey
        );
      }
    },
  };
};
