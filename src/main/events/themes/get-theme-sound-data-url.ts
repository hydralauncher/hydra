import { registerEvent } from "../register-event";
import { getThemeSoundPath } from "@main/helpers";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@main/services";

const getThemeSoundDataUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
): Promise<string | null> => {
  try {
    const soundPath = getThemeSoundPath(themeId);

    if (!soundPath || !fs.existsSync(soundPath)) {
      return null;
    }

    const buffer = await fs.promises.readFile(soundPath);
    const ext = path.extname(soundPath).toLowerCase().slice(1);

    const mimeTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      m4a: "audio/mp4",
    };

    const mimeType = mimeTypes[ext] || "audio/mpeg";
    const base64 = buffer.toString("base64");

    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    logger.error("Failed to get theme sound data URL", error);
    return null;
  }
};

registerEvent("getThemeSoundDataUrl", getThemeSoundDataUrl);
