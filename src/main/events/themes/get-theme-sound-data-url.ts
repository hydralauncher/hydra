import { registerEvent } from "../register-event";
import {
  getEffectiveThemeAchievementSound,
  getThemeSoundPath,
} from "@main/helpers";
import { themesSublevel } from "@main/level";
import fs from "node:fs";
import path from "node:path";
import { logger } from "@main/services";
import type { AchievementNotificationVariation } from "@types";

const MAX_SOUND_FILE_SIZE = 20 * 1024 * 1024;

const getThemeSoundDataUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  variation?: AchievementNotificationVariation
): Promise<string | null> => {
  try {
    const theme = await themesSublevel.get(themeId);
    if (!theme) return null;
    const resolvedVariation = variation ?? "default";
    const sound = getEffectiveThemeAchievementSound(theme, resolvedVariation);
    if (sound.mode === "muted") return "";
    if (sound.mode === "default") return null;
    const configuredVariationSound =
      theme.achievementSounds?.[resolvedVariation];
    const assetVariation =
      resolvedVariation !== "default" &&
      (!configuredVariationSound || configuredVariationSound.mode === "inherit")
        ? "default"
        : resolvedVariation;
    const soundPath = getThemeSoundPath(themeId, theme.name, assetVariation);

    if (!soundPath || !fs.existsSync(soundPath)) {
      return null;
    }

    if ((await fs.promises.stat(soundPath)).size > MAX_SOUND_FILE_SIZE) {
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
