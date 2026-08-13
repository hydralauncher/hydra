import fs from "node:fs";
import path from "node:path";

import type { Game, UserPreferences } from "@types";

import { INTERVALS } from "@main/constants";
import { db, levelKeys } from "@main/level";
import { AchievementImageService } from "../achievements/achievement-image-service";
import { AchievementSouvenirStore } from "../achievements/achievement-souvenir-store";
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

const watchers = new Map<string, ReturnType<typeof setInterval>>();

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
  const imageKey =
    await AchievementImageService.uploadAchievementImage(screenshotPath);

  await HydraApi.put("/profile/games/achievements", {
    id: game.remoteId,
    achievements: [{ name: achievement.id, unlockTime: Date.now(), imageKey }],
  });

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
  game: Game,
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
          achievement.title
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
  watchers.set(gameKey, watcher);
};

const startRetroArchWatcher = (
  gameKey: string,
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
        seen.add(entry);

        const match = RETROARCH_SOUVENIR.exec(entry);
        if (!match) continue;

        const screenshotPath = await ScreenshotService.importGameScreenshot(
          path.join(screenshotDirectory, entry),
          game.title,
          match[1]
        );

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
  watchers.set(gameKey, watcher);
};

interface StartEmulatorSouvenirWatcherOptions {
  gameKey: string;
  game: Game;
  system: EmulatorSessionSystem;
  executablePath: string;
}

export const startEmulatorSouvenirWatcher = async ({
  gameKey,
  game,
  system,
  executablePath,
}: StartEmulatorSouvenirWatcherOptions) => {
  if (watchers.has(gameKey)) return;
  if (!game.remoteId) return;
  if (!(await isSouvenirCaptureEnabled())) return;

  if (system === "ps3") return;

  if (system === "ps1") {
    const logPath = duckstationLogPath();

    if (logPath) {
      startLogWatcher(gameKey, game, logPath, DUCKSTATION_UNLOCK, false);
    }

    return;
  }

  if (system === "ps2") {
    const logPath = pcsx2LogPath(executablePath);

    if (logPath) {
      startLogWatcher(gameKey, game, logPath, PCSX2_UNLOCK, true);
    }

    return;
  }

  const configPath = findRetroArchConfig(executablePath);

  if (!configPath) return;

  startRetroArchWatcher(
    gameKey,
    game,
    readRetroArchScreenshotDirectory(configPath)
  );
};

export const stopEmulatorSouvenirWatcher = (gameKey: string) => {
  const watcher = watchers.get(gameKey);

  if (!watcher) return;

  clearInterval(watcher);
  watchers.delete(gameKey);
};
