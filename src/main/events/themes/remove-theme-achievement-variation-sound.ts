import fs from "node:fs";
import path from "node:path";
import type { AchievementNotificationVariation } from "@types";
import { THEMES_PATH } from "@main/constants";
import {
  getThemePath,
  getVariationSoundAssetName,
  isSupportedAchievementNotificationVariation,
} from "@main/helpers";
import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const removeThemeAchievementVariationSound = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  variation: AchievementNotificationVariation
): Promise<void> => {
  if (!isSupportedAchievementNotificationVariation(variation)) {
    throw new Error("Unsupported achievement notification variation");
  }

  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  const themeDir = getThemePath(themeId, theme.name);
  const legacyThemeDir = path.join(THEMES_PATH, themeId);

  const removeFromDir = async (dir: string) => {
    if (!fs.existsSync(dir)) return;

    for (const extension of [".wav", ".mp3", ".ogg", ".m4a"]) {
      const soundPath = path.join(
        dir,
        getVariationSoundAssetName(variation, extension)
      );

      if (fs.existsSync(soundPath)) {
        await fs.promises.unlink(soundPath);
      }
    }
  };

  await removeFromDir(themeDir);
  if (themeDir !== legacyThemeDir) {
    await removeFromDir(legacyThemeDir);
  }
};

registerEvent(
  "removeThemeAchievementVariationSound",
  removeThemeAchievementVariationSound
);
