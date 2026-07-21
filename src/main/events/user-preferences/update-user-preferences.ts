import { registerEvent } from "../register-event";
import path from "node:path";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { defaultDownloadsPath } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { patchUserProfile } from "../profile/update-profile";
import { DownloadManager, PathGrants, Wine } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { getDownloadDirectoryPreferences } from "@shared";

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

  // Downloads is long-term-tracked like wine prefix / proton / executable /
  // backup, so annotate its portal grant at pick time. Without this, a lost
  // downloads grant has no persisted (accessPath -> displayPath) mapping to
  // fall back on, and the "folder access lost" toast surfaces the raw
  // document-portal path (annotate is a no-op outside Flatpak).
  if (
    Object.hasOwn(preferences, "downloadsPath") ||
    Object.hasOwn(preferences, "downloadDirectories")
  ) {
    const downloadTargets = [
      updatedPreferences.downloadsPath,
      ...(updatedPreferences.downloadDirectories ?? []).map((dir) => dir.path),
    ].filter((targetPath): targetPath is string => Boolean(targetPath));

    await Promise.all(
      downloadTargets.map((targetPath) => PathGrants.annotate(targetPath))
    );
  }

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
