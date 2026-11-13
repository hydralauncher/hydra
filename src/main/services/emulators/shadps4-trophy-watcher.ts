import { promises as fs } from "node:fs";

import type { Game, UnlockedAchievement } from "@types";
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
  createShadps4LogScan,
  mergeTrophyUnlocks,
  parseUnlockedTrophies,
  readNewShadps4LogUnlocks,
  readShadps4TitleId,
  resolveShadps4LogFiles,
  resolveShadps4TrophyFiles,
  type Shadps4LogScan,
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

const prepareSouvenirCapture = async (gameKey: string) => {
  const [game, tracking] = await Promise.all([
    gamesSublevel.get(gameKey),
    loadEmulatorAchievementTracking(),
  ]);
  if (tracking.souvenirs && game?.remoteId) {
    await prepareLinuxGameCaptureSession(gameKey);
  }
};

export const startShadps4TrophyWatcher = ({
  gameKey,
  executablePath,
  discPath,
}: StartShadps4TrophyWatcherOptions): Shadps4TrophyWatcher => {
  const sessionStartedAt = Date.now();
  const logScans = new Map<string, Shadps4LogScan>();
  const pendingLogUnlocks = new Map<string, number>();
  let titleId: string | null = null;
  let foundTrophyFile = false;
  let lastModifiedAt = -1;
  let hasImportedExistingUnlocks = false;
  let nextCatalogueAttemptAt = 0;
  let inFlightRead: Promise<void> | null = null;

  const mergeUnlocks = async (
    game: Game,
    unlocks: UnlockedAchievement[],
    isFinalRead: boolean,
    publishNotification: boolean
  ): Promise<boolean> => {
    if (unlocks.length === 0) return true;
    if (!isFinalRead && Date.now() < nextCatalogueAttemptAt) return false;

    if (!(await hasTrophyCatalogue(game))) {
      nextCatalogueAttemptAt = Date.now() + CATALOGUE_RETRY_INTERVAL_MS;
      return false;
    }

    await mergeAchievements(game, unlocks, publishNotification, {
      skipSouvenirCapture: isFinalRead,
      alwaysUpdateInterface: true,
    });
    return true;
  };

  const readTrophyFiles = async (
    game: Game,
    isFinalRead: boolean
  ): Promise<boolean> => {
    const candidates = await resolveShadps4TrophyFiles(
      executablePath,
      discPath
    );
    const stats = await Promise.all(
      candidates.map((file) => fs.stat(file).catch(() => null))
    );
    const files = candidates.filter((_, index) => stats[index]);
    if (files.length === 0) return false;

    foundTrophyFile = true;
    const modifiedAt = Math.max(...stats.map((stat) => stat?.mtimeMs ?? -1));
    if (modifiedAt === lastModifiedAt) return true;

    const contents = await Promise.all(
      files.map((file) => fs.readFile(file, "utf8").catch(() => null))
    );
    const unlockLists = contents.map((xml) =>
      xml ? parseUnlockedTrophies(xml) : null
    );
    if (unlockLists.includes(null)) return true;

    const merged = await mergeUnlocks(
      game,
      mergeTrophyUnlocks(unlockLists as UnlockedAchievement[][]),
      isFinalRead,
      hasImportedExistingUnlocks
    );
    if (merged) {
      hasImportedExistingUnlocks = true;
      lastModifiedAt = modifiedAt;
    }
    return true;
  };

  const scanFor = (logFile: string): Shadps4LogScan => {
    const scan = logScans.get(logFile) ?? createShadps4LogScan();
    logScans.set(logFile, scan);
    return scan;
  };

  const readLog = async (game: Game, isFinalRead: boolean) => {
    titleId ??= await readShadps4TitleId(discPath);
    if (!titleId) return;
    const sessionTitleId = titleId;

    const unlockedIds = await Promise.all(
      resolveShadps4LogFiles(executablePath, sessionTitleId).map((logFile) =>
        readNewShadps4LogUnlocks(
          scanFor(logFile),
          logFile,
          sessionTitleId,
          sessionStartedAt
        )
      )
    );
    const seenAt = Date.now();
    for (const id of unlockedIds.flat()) {
      if (!pendingLogUnlocks.has(id)) pendingLogUnlocks.set(id, seenAt);
    }

    const unlocks = [...pendingLogUnlocks].map(([name, unlockTime]) => ({
      name,
      unlockTime,
    }));
    if (await mergeUnlocks(game, unlocks, isFinalRead, true)) {
      pendingLogUnlocks.clear();
    }
  };

  const readTrophies = async (isFinalRead: boolean) => {
    if (!HydraApi.isLoggedIn()) return;

    const game = await gamesSublevel.get(gameKey);
    if (!game) return;

    if (await readTrophyFiles(game, isFinalRead)) return;
    await readLog(game, isFinalRead);
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

  prepareSouvenirCapture(gameKey).catch((error) => {
    achievementsLogger.warn(
      "Failed to prepare shadPS4 trophy capture",
      gameKey,
      error
    );
  });

  const timer = setInterval(() => {
    if (inFlightRead === null) void runRead(false);
  }, INTERVALS.achievementWatcher);
  timer.unref?.();

  return {
    finish: async () => {
      clearInterval(timer);
      await inFlightRead;
      await runRead(true);

      const foundGameLog = [...logScans.values()].some(
        (scan) => scan.matchesGame
      );
      if (!foundTrophyFile && !foundGameLog && HydraApi.isLoggedIn()) {
        achievementsLogger.warn(
          "No shadPS4 trophy file or game log for this session",
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

  const trophyFiles = await resolveShadps4TrophyFiles(executablePath, discPath);
  await Promise.all(trophyFiles.map((file) => fs.rm(file, { force: true })));
};
