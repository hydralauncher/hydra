import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { getThemePath } from "@main/helpers";
import { themesSublevel } from "@main/level";
import { logger } from "@main/services";

const importThemeSoundFromStore = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  themeName: string,
  storeUrl: string
): Promise<void> => {
  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  const formats = ["wav", "mp3", "ogg", "m4a"];

  for (const format of formats) {
    try {
      const soundUrl = `${storeUrl}/themes/${themeName.toLowerCase()}/achievement.${format}`;
      
      const response = await axios.get(soundUrl, {
        responseType: "arraybuffer",
        timeout: 10000,
      });

      const themeDir = getThemePath(themeId);

      if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
      }

      const destinationPath = path.join(themeDir, `achievement.${format}`);
      await fs.promises.writeFile(destinationPath, response.data);

      await themesSublevel.put(themeId, {
        ...theme,
        hasCustomSound: true,
        updatedAt: new Date(),
      });

      logger.log(`Successfully imported sound for theme ${themeName}`);
      return;
    } catch (error) {
      continue;
    }
  }

  logger.log(`No sound file found for theme ${themeName} in store`);
};

registerEvent("importThemeSoundFromStore", importThemeSoundFromStore);

