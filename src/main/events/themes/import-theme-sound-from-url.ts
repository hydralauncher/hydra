import { registerEvent } from "../register-event";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { getThemePath } from "@main/helpers";
import { themesSublevel } from "@main/level";
import { logger } from "@main/services";

const importThemeSoundFromUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  soundUrl: string
): Promise<void> => {
  const theme = await themesSublevel.get(themeId);
  if (!theme) {
    throw new Error("Theme not found");
  }

  try {
    const response = await axios.get(soundUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
    });

    const urlExt = path.extname(new URL(soundUrl).pathname).toLowerCase();
    const ext =
      urlExt && [".wav", ".mp3", ".ogg", ".m4a"].includes(urlExt)
        ? urlExt
        : ".mp3";

    const themeDir = getThemePath(themeId, theme.name);

    if (!fs.existsSync(themeDir)) {
      fs.mkdirSync(themeDir, { recursive: true });
    }

    const destinationPath = path.join(themeDir, `achievement${ext}`);
    await fs.promises.writeFile(destinationPath, response.data);

    await themesSublevel.put(themeId, {
      ...theme,
      hasCustomSound: true,
      updatedAt: new Date(),
    });

    logger.log(`Successfully imported sound from URL for theme ${theme.name}`);
  } catch (error) {
    logger.error("Failed to import sound from URL", error);
    throw error;
  }
};

registerEvent("importThemeSoundFromUrl", importThemeSoundFromUrl);
