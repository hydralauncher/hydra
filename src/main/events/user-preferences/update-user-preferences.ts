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
import { gameAchievementsSublevel } from "@main/level/sublevels/game-achievements";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  let languageChanged = false;

  if (preferences.language) {
    await db.put<string, string>(levelKeys.language, preferences.language, {
      valueEncoding: "utf8",
    });

    i18next.changeLanguage(preferences.language);
    patchUserProfile({ language: preferences.language }).catch(() => {});
    languageChanged = true;
  }

  if (languageChanged) {
    const achievementsKeys: string[] = [];
    for await (const key of gameAchievementsSublevel.keys()) {
      achievementsKeys.push(key);
    }

    // Preserve unlockedAchievements when clearing cache to avoid re-notifying
    await Promise.all(
      achievementsKeys.map(async (key) => {
        const cached = await gameAchievementsSublevel.get(key);
        if (cached?.unlockedAchievements?.length) {
          await gameAchievementsSublevel.put(key, {
            ...cached,
            achievements: [],
            language: undefined,
            catalogueValidator: undefined,
            updatedAt: Date.now(),
          });
        } else {
          await gameAchievementsSublevel.del(key);
        }
      })
    );
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
