import fs from "node:fs";
import path from "node:path";

import { THEMES_PATH } from "@main/constants";
import {
  getThemePath,
  getVariationSoundAssetName,
  isSupportedAchievementNotificationVariation,
  isSupportedAchievementSoundFile,
} from "@main/helpers";
import { themesSublevel } from "@main/level";
import { WindowManager } from "@main/services";
import type {
  AchievementNotificationSoundMode,
  AchievementNotificationVariation,
} from "@types";

import { registerEvent } from "../register-event";

const AUDIO_EXTENSIONS = [".wav", ".mp3", ".ogg", ".m4a"];
const MAX_SOUND_FILE_SIZE = 20 * 1024 * 1024;
const SOUND_MODES = new Set<AchievementNotificationSoundMode>([
  "default",
  "inherit",
  "file",
  "muted",
]);

const removeVariationAssets = async (
  directories: string[],
  variation: AchievementNotificationVariation
) => {
  await Promise.all(
    directories.flatMap((directory) =>
      AUDIO_EXTENSIONS.map(async (extension) => {
        const assetPath = path.join(
          directory,
          getVariationSoundAssetName(variation, extension)
        );
        if (fs.existsSync(assetPath)) await fs.promises.unlink(assetPath);
      })
    )
  );
};

const setThemeAchievementSound = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  variation: AchievementNotificationVariation,
  mode: AchievementNotificationSoundMode,
  sourcePath?: string,
  volume?: number
) => {
  if (!isSupportedAchievementNotificationVariation(variation)) {
    throw new Error("Unsupported achievement notification variation");
  }
  if (!SOUND_MODES.has(mode)) throw new Error("Unsupported sound mode");
  if (variation === "default" && mode === "inherit") {
    throw new Error("Default achievement sound cannot inherit");
  }
  if (variation !== "default" && mode === "default") {
    throw new Error("Variation sounds must inherit the default sound");
  }

  const theme = await themesSublevel.get(themeId);
  if (!theme) throw new Error("Theme not found");

  if (
    mode === "file" &&
    sourcePath &&
    (!fs.existsSync(sourcePath) || !isSupportedAchievementSoundFile(sourcePath))
  ) {
    throw new Error("Unsupported achievement sound file");
  }
  if (
    mode === "file" &&
    sourcePath &&
    (await fs.promises.stat(sourcePath)).size > MAX_SOUND_FILE_SIZE
  ) {
    throw new Error("Achievement sound file is too large");
  }

  const themeDir = getThemePath(themeId, theme.name);
  const legacyThemeDir = path.join(THEMES_PATH, themeId);
  const directories =
    themeDir === legacyThemeDir ? [themeDir] : [themeDir, legacyThemeDir];
  if (mode !== "file" || sourcePath) {
    await removeVariationAssets(directories, variation);
  }

  if (mode === "file" && sourcePath) {
    await fs.promises.mkdir(themeDir, { recursive: true });
    await fs.promises.copyFile(
      sourcePath,
      path.join(
        themeDir,
        getVariationSoundAssetName(variation, path.extname(sourcePath))
      )
    );
  }

  const normalizedVolume =
    typeof volume === "number" ? Math.min(Math.max(volume, 0), 1) : undefined;
  const previousSound = theme.achievementSounds?.[variation];
  const originalPath =
    sourcePath ??
    previousSound?.originalPath ??
    (variation === "default" ? theme.originalSoundPath : undefined);
  const achievementSounds = {
    ...theme.achievementSounds,
    [variation]: {
      mode,
      ...(mode === "file" && originalPath ? { originalPath } : {}),
      ...(mode !== "inherit" && normalizedVolume !== undefined
        ? { volume: normalizedVolume }
        : {}),
    },
  };

  await themesSublevel.put(themeId, {
    ...theme,
    achievementSounds,
    ...(variation === "default"
      ? {
          hasCustomSound: mode === "file",
          originalSoundPath: mode === "file" ? originalPath : undefined,
        }
      : {}),
    updatedAt: new Date(),
  });

  WindowManager.mainWindow?.webContents.send("on-custom-theme-updated");
  WindowManager.notificationWindow?.webContents.send("on-custom-theme-updated");
};

registerEvent("setThemeAchievementSound", setThemeAchievementSound);
