import { registerEvent } from "../register-event";
import fs from "node:fs";
import { getThemePath } from "@main/helpers";
import { themesSublevel } from "@main/level";
import path from "node:path";

const removeThemeAchievementSound = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
): Promise<void> => {
  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  const themeDir = getThemePath(themeId);

  if (!fs.existsSync(themeDir)) {
    return;
  }

  const formats = ["wav", "mp3", "ogg", "m4a"];

  for (const format of formats) {
    const soundPath = path.join(themeDir, `achievement.${format}`);
    if (fs.existsSync(soundPath)) {
      await fs.promises.unlink(soundPath);
    }
  }

  await themesSublevel.put(themeId, {
    ...theme,
    hasCustomSound: false,
    updatedAt: new Date(),
  });
};

registerEvent("removeThemeAchievementSound", removeThemeAchievementSound);
