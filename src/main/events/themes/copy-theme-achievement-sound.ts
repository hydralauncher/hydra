import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import { getThemePath } from "@main/helpers";
import { themesSublevel } from "@main/level";

const copyThemeAchievementSound = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  sourcePath: string
): Promise<void> => {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error("Source file does not exist");
  }

  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  const themeDir = getThemePath(themeId);

  if (!fs.existsSync(themeDir)) {
    fs.mkdirSync(themeDir, { recursive: true });
  }

  const fileExtension = path.extname(sourcePath);
  const destinationPath = path.join(themeDir, `achievement${fileExtension}`);

  await fs.promises.copyFile(sourcePath, destinationPath);

  await themesSublevel.put(themeId, {
    ...theme,
    hasCustomSound: true,
    originalSoundPath: sourcePath,
    updatedAt: new Date(),
  });
};

registerEvent("copyThemeAchievementSound", copyThemeAchievementSound);
