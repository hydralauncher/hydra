import fs from "node:fs";
import path from "node:path";

import type { Game, UserPreferences } from "@types";

import { INTERVALS } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { AchievementImageService } from "../achievements/achievement-image-service";
import { AchievementSouvenirStore } from "../achievements/achievement-souvenir-store";
import { PendingAchievementSouvenirStore } from "../achievements/pending-achievement-souvenir-store";
import { HydraApi } from "../hydra-api";
import { achievementsLogger } from "../logger";
import { ScreenshotService } from "../screenshot";
import {
  findRetroArchConfig,
  readRetroArchScreenshotDirectory,
} from "./emulator-souvenir-config";
import { duckstationLogPath, pcsx2LogPath } from "./emulator-log-paths";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";

const DUCKSTATION_UNLOCK = /Achievement (\d+) \((.*?)\) for game \d+ unlocked/;
const PCSX2_UNLOCK =
  /Achievements: Achievement (.*?) \((\d+)\) for game \d+ unlocked/;
const RETROARCH_SOUVENIR = /-cheevo-(\d+)\.[a-z]+$/i;

interface UnlockedAchievement {
  id: string;
  title: string;
}

interface WatcherRegistration {
  token: object;
  timer: ReturnType<typeof setInterval> | null;
}

const watchers = new Map<string, WatcherRegistration>();

const isSouvenirCaptureEnabled = async () => {
  if (process.platform === "linux") return false;
  if (!HydraApi.hasActiveSubscription()) return false;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  return userPreferences?.enableAchievementSouvenirs === true;
};

const publishSouvenir = async (
  game: Game,
  achievement: UnlockedAchievement,
  screenshotPath: string
) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const imageKey =
    await AchievementImageService.uploadAchievementImage(screenshotPath);

  await PendingAchievementSouvenirStore.set(gameKey, achievement.id, imageKey);

  await HydraApi.put("/profile/games/achievements", {
    id: game.remoteId,
    achievements: [{ name: achievement.id, unlockTime: Date.now(), imageKey }],
  });

  await PendingAchievementSouvenirStore.clearSynced(gameKey, [
    { name: achievement.id, imageKey },
  ]);

  AchievementSouvenirStore.invalidate(game.shop, game.objectId);

  await ScreenshotService.cleanupOldScreenshots();
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

  const watcher = setInterval(() => {
    void (async () => {
      if (!(await isSouvenirCaptureEnabled())) return;

      for (const achievement of await readNewUnlocks()) {
        const screenshotPath = await ScreenshotService.captureGameScreenshot(
          game.title,
          achievement.title,
          game.remoteId!,
          achievement.id,
          processId
        );

        await publishSouvenir(game, achievement, screenshotPath);
      }
    })().catch((error) => {
      achievementsLogger.error(
        "Failed to capture emulator souvenir",
        game.objectId,
        error
      );
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
  screenshotDirectory: string
) => {
  const seen = new Set(
    fs.existsSync(screenshotDirectory)
      ? fs.readdirSync(screenshotDirectory)
      : []
  );

  const watcher = setInterval(() => {
    void (async () => {
      if (!(await isSouvenirCaptureEnabled())) return;

      const entries = await fs.promises
        .readdir(screenshotDirectory)
        .catch(() => []);

      for (const entry of entries) {
        if (seen.has(entry)) continue;
        const match = RETROARCH_SOUVENIR.exec(entry);
        if (!match) {
          seen.add(entry);
          continue;
        }

        const sourcePath = path.join(screenshotDirectory, entry);

        const screenshotPath = await ScreenshotService.importGameScreenshot(
          sourcePath,
          game.title,
          match[1],
          game.remoteId!,
          match[1]
        );

        await fs.promises.rm(sourcePath, { force: true });
        seen.add(entry);

        await publishSouvenir(
          game,
          { id: match[1], title: match[1] },
          screenshotPath
        );
      }
    })().catch((error) => {
      achievementsLogger.error(
        "Failed to import RetroArch souvenir",
        game.objectId,
        error
      );
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
}: StartEmulatorSouvenirWatcherOptions) => {
  const previousWatcher = watchers.get(gameKey);
  if (previousWatcher?.timer) clearInterval(previousWatcher.timer);
  watchers.set(gameKey, { token: watcherToken, timer: null });

  if (!game.remoteId) {
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
    startConfiguredLogWatcher({
      gameKey,
      watcherToken,
      game,
      processId,
      logPath: duckstationLogPath(),
      pattern: DUCKSTATION_UNLOCK,
      titleFirst: false,
    });
    return;
  }

  if (system === "ps2") {
    startConfiguredLogWatcher({
      gameKey,
      watcherToken,
      game,
      processId,
      logPath: pcsx2LogPath(executablePath),
      pattern: PCSX2_UNLOCK,
      titleFirst: true,
    });
    return;
  }

  const configPath = findRetroArchConfig(executablePath);

  if (!configPath) {
    stopEmulatorSouvenirWatcher(gameKey, watcherToken);
    return;
  }

  startRetroArchWatcher(
    gameKey,
    watcherToken,
    game,
    readRetroArchScreenshotDirectory(configPath)
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
