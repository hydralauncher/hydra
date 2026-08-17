import { registerEvent } from "../register-event";
import path from "node:path";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { defaultDownloadsPath } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { patchUserProfile } from "../profile/update-profile";
import { DownloadManager, Wine } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { getDownloadDirectoryPreferences } from "@shared";
import {
  enableRetroArchAchievementScreenshots,
  restoreRetroArchAchievementScreenshots,
} from "@main/services/emulators/emulator-souvenir-config";
import { getRetroArchConfig } from "@main/services/retroarch/retroarch-repository";
import {
  prepareLinuxGameCaptureSession,
  stopAllLinuxGameCaptureSessions,
} from "@main/services/linux-game-capture-session";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (preferences.language) {
    await db.put<string, string>(levelKeys.language, preferences.language, {
      valueEncoding: "utf8",
    });

    i18next.changeLanguage(preferences.language);
    patchUserProfile({ language: preferences.language }).catch(() => {});
  }

  const shouldPinExistingWinePrefixes =
    process.platform === "linux" &&
    Object.hasOwn(preferences, "defaultWinePrefixPath") &&
    preferences.defaultWinePrefixPath !==
      userPreferences?.defaultWinePrefixPath;

  if (shouldPinExistingWinePrefixes) {
    const games = await gamesSublevel.values().all();

    await Promise.all(
      games.map(async (game) => {
        if (game.winePrefixPath || !game.executablePath) {
          return;
        }

        if (path.extname(game.executablePath).toLowerCase() !== ".exe") {
          return;
        }

        const resolvedWinePrefixPath = Wine.getDefaultPrefixPathForGame(
          game.objectId
        );

        if (!resolvedWinePrefixPath) {
          return;
        }

        await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
          ...game,
          winePrefixPath: resolvedWinePrefixPath,
        });
      })
    );
  }

  const mergedPreferences = {
    ...userPreferences,
    ...preferences,
  };
  const normalizedDownloadDirectoryPreferences =
    getDownloadDirectoryPreferences(mergedPreferences, defaultDownloadsPath);
  const updatedPreferences = {
    ...mergedPreferences,
    ...normalizedDownloadDirectoryPreferences,
  };

  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    updatedPreferences,
    {
      valueEncoding: "json",
    }
  );

  Wine.syncUserPreferences(updatedPreferences);

  if (Object.hasOwn(preferences, "enableAchievementSouvenirs")) {
    if (preferences.enableAchievementSouvenirs === true) {
      const retroArchConfig = await getRetroArchConfig();

      if (retroArchConfig.executablePath) {
        await enableRetroArchAchievementScreenshots(
          retroArchConfig.executablePath
        );
      }

      if (process.platform === "linux") {
        const [{ gamesPlaytime }, { emulatorSessions }] = await Promise.all([
          import("@main/services/game-running-state"),
          import("@main/services/emulators/emulator-session-tracker"),
        ]);
        const runningGameKeys = new Set(gamesPlaytime.keys());

        for (const [gameKey, session] of emulatorSessions) {
          if (session.system === "ps1" || session.system === "ps2") {
            runningGameKeys.add(gameKey);
          }
        }

        for (const gameKey of runningGameKeys) {
          const game = await gamesSublevel.get(gameKey).catch(() => null);
          if (game?.remoteId) void prepareLinuxGameCaptureSession(gameKey);
        }
      }
    } else {
      stopAllLinuxGameCaptureSessions();
      await restoreRetroArchAchievementScreenshots();
    }
  }

  WindowManager.sendToAppWindows(
    "on-user-preferences-updated",
    updatedPreferences
  );

  if (Object.hasOwn(preferences, "maxDownloadSpeedBytesPerSecond")) {
    await DownloadManager.applyDownloadSpeedLimit(
      preferences.maxDownloadSpeedBytesPerSecond ?? null
    );
  }

  if (Object.hasOwn(preferences, "torrentNetworkInterface")) {
    await DownloadManager.applyNetworkInterface(
      preferences.torrentNetworkInterface ?? null
    );
  }
};

registerEvent("updateUserPreferences", updateUserPreferences);
