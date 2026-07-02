import fs from "node:fs";
import path from "node:path";
import type { AchievementNotificationVariation } from "@types";
import {
  getThemePath,
  getVariationSoundAssetName,
  isSupportedAchievementNotificationVariation,
  isSupportedAchievementSoundFile,
} from "@main/helpers";
import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const copyThemeAchievementVariationSound = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  variation: AchievementNotificationVariation,
  sourcePath: string
): Promise<void> => {
  if (!isSupportedAchievementNotificationVariation(variation)) {
    throw new Error("Unsupported achievement notification variation");
  }

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("Source file does not exist");
  }

  if (!isSupportedAchievementSoundFile(sourcePath)) {
    throw new Error("Unsupported achievement sound file");
  }

  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  const themeDir = getThemePath(themeId, theme.name);

  if (!fs.existsSync(themeDir)) {
    fs.mkdirSync(themeDir, { recursive: true });
  }

  await fs.promises.copyFile(
    sourcePath,
    path.join(
      themeDir,
      getVariationSoundAssetName(variation, path.extname(sourcePath))
    )
  );
};

registerEvent(
  "copyThemeAchievementVariationSound",
  copyThemeAchievementVariationSound
);
