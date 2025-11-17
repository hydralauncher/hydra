import { registerEvent } from "../register-event";
import fs from "node:fs";
import { getThemePath } from "@main/helpers";
import { themesSublevel } from "@main/level";
import { THEMES_PATH } from "@main/constants";
import path from "node:path";

const removeThemeAchievementSound = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
): Promise<void> => {
  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  const themeDir = getThemePath(themeId, theme.name);
  const legacyThemeDir = path.join(THEMES_PATH(), themeId);

  const removeFromDir = async (dir: string) => {
    if (!fs.existsSync(dir)) {
      return;
    }

    const formats = ["wav", "mp3", "ogg", "m4a"];

    for (const format of formats) {
      const soundPath = path.join(dir, `achievement.${format}`);
      if (fs.existsSync(soundPath)) {
        await fs.promises.unlink(soundPath);
      }
    }
  };

  await removeFromDir(themeDir);
  if (themeDir !== legacyThemeDir) {
    await removeFromDir(legacyThemeDir);
  }

  await themesSublevel.put(themeId, {
    ...theme,
    hasCustomSound: false,
    originalSoundPath: undefined,
    updatedAt: new Date(),
  });
};

registerEvent("removeThemeAchievementSound", removeThemeAchievementSound);
