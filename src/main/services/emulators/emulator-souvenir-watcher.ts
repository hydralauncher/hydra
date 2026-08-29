import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { Game, User, UserPreferences } from "@types";
import { isAchievementSouvenirsEnabled } from "@shared";

import { INTERVALS } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { achievementsLogger } from "../logger";
import { BlankScreenshotError, ScreenshotService } from "../screenshot";
import { duckstationLogPath, pcsx2LogPath } from "./emulator-log-paths";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";
import { prepareLinuxGameCaptureSession } from "../linux-game-capture-session";
import { PendingGroupedSouvenirStore } from "../achievements/grouped-souvenir-store";
import { groupedSouvenirWorker } from "../achievements/grouped-souvenir-worker";
import { syncRetroAchievements } from "../retro-achievements/retro-achievements-sync";
import {
  groupRetroArchSouvenirAchievements,
  partitionHandledRetroArchSouvenirs,
  type RetroArchSouvenirAchievement,
} from "./retroarch-souvenir-achievement-group";

const DUCKSTATION_UNLOCK = /Achievement (\d+) \((.*?)\) for game \d+ unlocked/;
const PCSX2_UNLOCK =
  /Achievements: Achievement (.*?) \((\d+)\) for game \d+ unlocked/;
const RETROARCH_SOUVENIR = /-cheevo-(\d+)\.[a-z]+$/i;
const RETROARCH_SCREENSHOT_STABILITY_ATTEMPTS = 5;
const RETROARCH_SCREENSHOT_STABILITY_DELAY_MS = 100;
const RETROARCH_RECONCILIATION_ATTEMPTS = 2;
const RETROARCH_RECONCILIATION_DELAY_MS = 1_000;

type UnlockedAchievement = RetroArchSouvenirAchievement;

interface WatcherRegistration {
  token: object;
  timer: ReturnType<typeof setInterval> | null;
}

const watchers = new Map<string, WatcherRegistration>();

const isSouvenirCaptureEnabled = async () => {
  if (!HydraApi.hasActiveSubscription()) return false;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  return isAchievementSouvenirsEnabled(
    userPreferences?.enableAchievementSouvenirs,
    process.platform
  );
};

const queueGroupedSouvenir = async (
  game: Game,
  achievements: UnlockedAchievement[],
  screenshotPath: string,
  clientId: string,
  capturedAt: number
) => {
  if (!game.remoteId) {
    throw new Error("Cannot queue an emulator souvenir without a remote game");
  }

  const owner = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });
  if (!owner?.id) {
    throw new Error("Cannot queue an emulator souvenir without an owner");
  }

  const gameKey = levelKeys.game(game.shop, game.objectId);
  await PendingGroupedSouvenirStore.put({
    clientId,
    ownerId: owner.id,
    remoteGameId: game.remoteId,
    gameKey,
    screenshotPath,
    capturedAt,
    achievements: achievements.map((achievement) => ({
      name: achievement.id,
      unlockTime: achievement.unlockTime ?? capturedAt,
    })),
    status: "pending",
    attemptCount: 0,
  });

  void groupedSouvenirWorker.trigger();
};

const uniqueUnlocks = (achievements: UnlockedAchievement[]) =>
  Array.from(
    new Map(
      achievements.map((achievement) => [
        achievement.id.toLowerCase(),
        achievement,
      ])
    ).values()
  );

const waitForRetroAchievementsReconciliation = () =>
  new Promise((resolve) => {
    setTimeout(resolve, RETROARCH_RECONCILIATION_DELAY_MS);
  });

const reconcileRetroArchAchievements = async (
  game: Game,
  detectedAchievements: UnlockedAchievement[]
) => {
  let reconciledAchievements = detectedAchievements;

  for (
    let attempt = 0;
    attempt < RETROARCH_RECONCILIATION_ATTEMPTS;
    attempt++
  ) {
    if (attempt > 0) await waitForRetroAchievementsReconciliation();

    const result = await syncRetroAchievements({
      objectId: game.objectId,
      shop: game.shop,
    });
    if (result.status !== "success") return reconciledAchievements;

    reconciledAchievements = groupRetroArchSouvenirAchievements(
      detectedAchievements,
      result.achievements
    );
    if (reconciledAchievements.length > detectedAchievements.length) {
      achievementsLogger.info("Grouped simultaneous RetroArch achievements", {
        objectId: game.objectId,
        achievementIds: reconciledAchievements.map(({ id }) => id),
      });
      return reconciledAchievements;
    }
  }

  return reconciledAchievements;
};

interface RetroArchSouvenirFile {
  directory: string;
  entry: string;
  achievement: UnlockedAchievement;
}

const waitForRetroArchScreenshot = async (sourcePath: string) => {
  let previousSize = -1;
  let previousModifiedAt = -1;

  for (
    let attempt = 0;
    attempt < RETROARCH_SCREENSHOT_STABILITY_ATTEMPTS;
    attempt++
  ) {
    const stats = await fs.promises.stat(sourcePath);
    if (
      stats.size > 0 &&
      stats.size === previousSize &&
      stats.mtimeMs === previousModifiedAt
    ) {
      return;
    }

    previousSize = stats.size;
    previousModifiedAt = stats.mtimeMs;
    await new Promise((resolve) => {
      setTimeout(resolve, RETROARCH_SCREENSHOT_STABILITY_DELAY_MS);
    });
  }

  throw new Error(`RetroArch screenshot did not stabilize: ${sourcePath}`);
};

const removeRetroArchSourceFiles = async (
  souvenirs: RetroArchSouvenirFile[],
  seenByDirectory: Map<string, Set<string>>
) => {
  for (const { directory, entry } of souvenirs) {
    await fs.promises.rm(path.join(directory, entry), { force: true });
    seenByDirectory.get(directory)?.add(entry);
  }
};

interface ImportRetroArchScreenshotOptions {
  gameKey: string;
  game: Game;
  processId: number;
  achievements: UnlockedAchievement[];
  souvenirs: RetroArchSouvenirFile[];
  seenByDirectory: Map<string, Set<string>>;
  clientId: string;
}

const importRetroArchScreenshot = async ({
  gameKey,
  game,
  processId,
  achievements,
  souvenirs,
  seenByDirectory,
  clientId,
}: ImportRetroArchScreenshotOptions) => {
  const sourcePath = path.join(souvenirs[0].directory, souvenirs[0].entry);
  await waitForRetroArchScreenshot(sourcePath);

  try {
    return await ScreenshotService.importGameScreenshot(
      sourcePath,
      game.title,
      achievements[0].title,
      game.remoteId!,
      clientId
    );
  } catch (error) {
    if (!(error instanceof BlankScreenshotError)) throw error;

    achievementsLogger.warn("RetroArch produced a blank souvenir screenshot", {
      objectId: game.objectId,
      sourcePath,
    });

    if (process.platform === "win32") {
      try {
        const screenshotPath = await ScreenshotService.captureGameScreenshot(
          game.title,
          achievements[0].title,
          game.remoteId!,
          clientId,
          { processId, gameKey }
        );
        achievementsLogger.info(
          "Replaced a blank RetroArch souvenir screenshot",
          { objectId: game.objectId, sourcePath }
        );
        return screenshotPath;
      } catch (fallbackError) {
        achievementsLogger.warn(
          "Failed to replace a blank RetroArch souvenir screenshot",
          { objectId: game.objectId, sourcePath, error: fallbackError }
        );
      }
    }

    await removeRetroArchSourceFiles(souvenirs, seenByDirectory);
    return null;
  }
};

const readRetroArchDirectoryEntries = async (
  gameObjectId: string,
  directory: string,
  unreadableDirectories: Set<string>
) => {
  try {
    const entries = await fs.promises.readdir(directory);
    unreadableDirectories.delete(directory);
    return entries;
  } catch (error) {
    if (!unreadableDirectories.has(directory)) {
      achievementsLogger.error(
        "Failed to read RetroArch screenshot directory",
        gameObjectId,
        directory,
        error
      );
      unreadableDirectories.add(directory);
    }

    return null;
  }
};

const getRetroArchSouvenirAchievement = (
  entry: string
): UnlockedAchievement | null => {
  const match = RETROARCH_SOUVENIR.exec(entry);
  if (!match) return null;

  return { id: match[1], title: match[1] };
};

const collectNewRetroArchSouvenirs = async (
  gameObjectId: string,
  seenByDirectory: Map<string, Set<string>>,
  unreadableDirectories: Set<string>
) => {
  const newSouvenirs: RetroArchSouvenirFile[] = [];

  for (const [directory, seen] of seenByDirectory) {
    const entries = await readRetroArchDirectoryEntries(
      gameObjectId,
      directory,
      unreadableDirectories
    );
    if (!entries) continue;

    for (const entry of entries) {
      if (seen.has(entry)) continue;

      const achievement = getRetroArchSouvenirAchievement(entry);
      if (!achievement) {
        seen.add(entry);
        continue;
      }

      newSouvenirs.push({ directory, entry, achievement });
    }
  }

  return newSouvenirs;
};

const createLogTail = (
  logPath: string,
  pattern: RegExp,
  titleFirst: boolean
) => {
  let offset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
  let remainder = "";

  return async (): Promise<UnlockedAchievement[]> => {
    const stats = await fs.promises.stat(logPath).catch(() => null);

    if (!stats) return [];

    if (stats.size < offset) {
      offset = 0;
      remainder = "";
    }

    if (stats.size === offset) return [];

    const handle = await fs.promises.open(logPath, "r");
    const length = stats.size - offset;
    const buffer = Buffer.alloc(length);

    await handle.read(buffer, 0, length, offset);
    await handle.close();

    offset = stats.size;

    const lines = (remainder + buffer.toString("utf8")).split(/\r?\n/);
    remainder = lines.pop() ?? "";

    return lines
      .map((line) => pattern.exec(line))
      .filter((match) => !!match)
      .map((match) => ({
        id: titleFirst ? match[2] : match[1],
        title: titleFirst ? match[1] : match[2],
      }));
  };
};

const startLogWatcher = (
  gameKey: string,
  watcherToken: object,
  game: Game,
  processId: number,
  logPath: string,
  pattern: RegExp,
  titleFirst: boolean
) => {
  const readNewUnlocks = createLogTail(logPath, pattern, titleFirst);
  let isProcessing = false;

  const watcher = setInterval(() => {
    if (isProcessing) return;
    isProcessing = true;

    void (async () => {
      if (!(await isSouvenirCaptureEnabled())) return;

      const achievements = uniqueUnlocks(await readNewUnlocks());
      if (achievements.length === 0) return;

      const capturedAt = Date.now();
      const clientId = randomUUID();
      const screenshotPath = await ScreenshotService.captureGameScreenshot(
        game.title,
        achievements[0].title,
        game.remoteId!,
        clientId,
        { processId, gameKey }
      );

      try {
        await queueGroupedSouvenir(
          game,
          achievements,
          screenshotPath,
          clientId,
          capturedAt
        );
      } catch (error) {
        await ScreenshotService.deleteScreenshot(screenshotPath).catch(
          () => {}
        );
        throw error;
      }
    })()
      .catch((error) => {
        achievementsLogger.error(
          "Failed to capture emulator souvenir",
          game.objectId,
          error
        );
      })
      .finally(() => {
        isProcessing = false;
      });
  }, INTERVALS.emulatorSouvenirWatcher);

  watcher.unref?.();
  const registration = watchers.get(gameKey);

  if (registration?.token === watcherToken) {
    registration.timer = watcher;
  } else {
    clearInterval(watcher);
  }
};

const startRetroArchWatcher = (
  gameKey: string,
  watcherToken: object,
  game: Game,
  processId: number,
  screenshotDirectories: string[]
) => {
  const seenByDirectory = new Map(
    screenshotDirectories.map((directory) => [
      directory,
      new Set(fs.existsSync(directory) ? fs.readdirSync(directory) : []),
    ])
  );
  const unreadableDirectories = new Set<string>();
  const handledAchievementIds = new Set<string>();
  let isProcessing = false;

  achievementsLogger.info("Started RetroArch souvenir watcher", {
    objectId: game.objectId,
    screenshotDirectories,
  });

  const watcher = setInterval(() => {
    if (isProcessing) return;
    isProcessing = true;

    void (async () => {
      if (!(await isSouvenirCaptureEnabled())) return;

      const detectedSouvenirs = await collectNewRetroArchSouvenirs(
        game.objectId,
        seenByDirectory,
        unreadableDirectories
      );
      const { handled: redundantSouvenirs, unhandled: newSouvenirs } =
        partitionHandledRetroArchSouvenirs(
          detectedSouvenirs,
          handledAchievementIds
        );

      if (redundantSouvenirs.length > 0) {
        await removeRetroArchSourceFiles(redundantSouvenirs, seenByDirectory);
        achievementsLogger.info(
          "Removed delayed screenshots for grouped RetroArch achievements",
          {
            objectId: game.objectId,
            achievementIds: redundantSouvenirs.map(
              ({ achievement }) => achievement.id
            ),
          }
        );
      }

      const achievements = uniqueUnlocks(
        newSouvenirs.map(({ achievement }) => achievement)
      );
      if (achievements.length === 0) return;

      achievementsLogger.info("Detected RetroArch achievement screenshots", {
        objectId: game.objectId,
        files: newSouvenirs.map(({ directory, entry }) =>
          path.join(directory, entry)
        ),
      });

      const capturedAt = Date.now();
      const clientId = randomUUID();
      const screenshotPath = await importRetroArchScreenshot({
        gameKey,
        game,
        processId,
        achievements,
        souvenirs: newSouvenirs,
        seenByDirectory,
        clientId,
      });
      if (!screenshotPath) return;

      let groupedAchievements = achievements;
      try {
        groupedAchievements = await reconcileRetroArchAchievements(
          game,
          achievements
        );
      } catch (error) {
        achievementsLogger.warn(
          "Failed to reconcile simultaneous RetroArch achievements",
          { objectId: game.objectId, error }
        );
      }

      try {
        await queueGroupedSouvenir(
          game,
          groupedAchievements,
          screenshotPath,
          clientId,
          capturedAt
        );
      } catch (error) {
        await ScreenshotService.deleteScreenshot(screenshotPath).catch(
          () => {}
        );
        throw error;
      }

      for (const achievement of groupedAchievements) {
        handledAchievementIds.add(achievement.id.toLowerCase());
      }

      await removeRetroArchSourceFiles(newSouvenirs, seenByDirectory);
    })()
      .catch((error) => {
        achievementsLogger.error(
          "Failed to import RetroArch souvenir",
          game.objectId,
          error
        );
      })
      .finally(() => {
        isProcessing = false;
      });
  }, INTERVALS.emulatorSouvenirWatcher);

  watcher.unref?.();
  const registration = watchers.get(gameKey);

  if (registration?.token === watcherToken) {
    registration.timer = watcher;
  } else {
    clearInterval(watcher);
  }
};

interface StartEmulatorSouvenirWatcherOptions {
  gameKey: string;
  game: Game;
  system: EmulatorSessionSystem;
  executablePath: string;
  processId: number;
  watcherToken: object;
  screenshotDirectories?: string[];
}

interface StartConfiguredLogWatcherOptions {
  gameKey: string;
  watcherToken: object;
  game: Game;
  processId: number;
  logPath: string | null;
  pattern: RegExp;
  titleFirst: boolean;
}

const startConfiguredLogWatcher = ({
  gameKey,
  watcherToken,
  game,
  processId,
  logPath,
  pattern,
  titleFirst,
}: StartConfiguredLogWatcherOptions) => {
  if (!logPath) {
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }

  startLogWatcher(
    gameKey,
    watcherToken,
    game,
    processId,
    logPath,
    pattern,
    titleFirst
  );
};

export const startEmulatorSouvenirWatcher = async ({
  gameKey,
  game,
  system,
  executablePath,
  processId,
  watcherToken,
  screenshotDirectories,
}: StartEmulatorSouvenirWatcherOptions) => {
  const previousWatcher = watchers.get(gameKey);
  if (previousWatcher?.timer) clearInterval(previousWatcher.timer);
  watchers.set(gameKey, { token: watcherToken, timer: null });

  if (!game.remoteId) {
    achievementsLogger.warn(
      "Could not start emulator souvenir watcher because the remote game was not resolved",
      { objectId: game.objectId, shop: game.shop }
    );
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }
  if (!(await isSouvenirCaptureEnabled())) {
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }
  if (watchers.get(gameKey)?.token !== watcherToken) return;

  if (system === "ps3") {
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }

  if (system === "ps1") {
    const capturePreparation = prepareLinuxGameCaptureSession(gameKey);
    startConfiguredLogWatcher({
      gameKey,
      watcherToken,
      game,
      processId,
      logPath: duckstationLogPath(),
      pattern: DUCKSTATION_UNLOCK,
      titleFirst: false,
    });
    await capturePreparation;
    return;
  }

  if (system === "ps2") {
    const capturePreparation = prepareLinuxGameCaptureSession(gameKey);
    startConfiguredLogWatcher({
      gameKey,
      watcherToken,
      game,
      processId,
      logPath: pcsx2LogPath(executablePath),
      pattern: PCSX2_UNLOCK,
      titleFirst: true,
    });
    await capturePreparation;
    return;
  }

  if (!screenshotDirectories?.length) {
    achievementsLogger.error(
      "Could not start RetroArch souvenir watcher because the session directory was not prepared",
      { objectId: game.objectId, executablePath }
    );
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }

  startRetroArchWatcher(
    gameKey,
    watcherToken,
    game,
    processId,
    screenshotDirectories
  );
};

export const stopEmulatorSouvenirWatcher = (
  gameKey: string,
  watcherToken?: object
) => {
  const registration = watchers.get(gameKey);

  if (!registration) return;
  if (watcherToken && registration.token !== watcherToken) return;

  if (registration.timer) clearInterval(registration.timer);
  watchers.delete(gameKey);
};
