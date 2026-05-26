import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import {
  getThemePath,
  isValidThemeSoundBuffer,
  removeThemeSoundFiles,
  themeSoundFormats,
} from "@main/helpers";
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

  for (const format of themeSoundFormats) {
    try {
      const soundUrl = `${storeUrl}/themes/${themeName.toLowerCase()}/achievement.${format}`;

      const response = await axios.get(soundUrl, {
        responseType: "arraybuffer",
        timeout: 10000,
      });

      const buffer = Buffer.from(response.data);

      if (!isValidThemeSoundBuffer(buffer, format)) {
        logger.log(
          `Skipping invalid ${format} sound for theme ${themeName}`,
          response.headers["content-type"]
        );
        continue;
      }

      const themeDir = getThemePath(themeId, theme.name);

      if (!fs.existsSync(themeDir)) {
        fs.mkdirSync(themeDir, { recursive: true });
      }

      await removeThemeSoundFiles(themeDir);

      const destinationPath = path.join(themeDir, `achievement.${format}`);
      await fs.promises.writeFile(destinationPath, buffer);

      await themesSublevel.put(themeId, {
        ...theme,
        hasCustomSound: true,
        updatedAt: new Date(),
      });

      logger.log(`Successfully imported sound for theme ${themeName}`);
      return;
    } catch (error) {
      logger.error(
        `Failed to import ${format} sound for theme ${themeName}`,
        error
      );
      continue;
    }
  }

  logger.log(`No sound file found for theme ${themeName} in store`);
};

registerEvent("importThemeSoundFromStore", importThemeSoundFromStore);
