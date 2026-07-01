import fs from "node:fs";
import path from "node:path";
import type {
  AchievementNotificationVariation,
  AchievementNotificationVariationSound,
} from "@types";
import {
  getStructuredAchievementSoundPath,
  getThemeSoundPath,
} from "@main/helpers";
import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const getSoundDataUrl = async (soundPath: string): Promise<string | null> => {
  if (!fs.existsSync(soundPath)) return null;

  const buffer = await fs.promises.readFile(soundPath);
  const ext = path.extname(soundPath).toLowerCase().slice(1);
  const mimeTypes: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
  };

  return `data:${mimeTypes[ext] || "audio/mpeg"};base64,${buffer.toString(
    "base64"
  )}`;
};

const getAchievementNotificationSoundDataUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string,
  variation: AchievementNotificationVariation,
  sound?: AchievementNotificationVariationSound
): Promise<string | null> => {
  if (sound?.mode === "muted") return "";

  const structuredSoundPath = await getStructuredAchievementSoundPath(sound);
  if (structuredSoundPath) {
    return getSoundDataUrl(structuredSoundPath);
  }

  if (!themeId) {
    return null;
  }

  const theme = await themesSublevel.get(themeId);
  const themeSoundPath = getThemeSoundPath(themeId, theme?.name, variation);
  if (themeSoundPath) {
    return getSoundDataUrl(themeSoundPath);
  }

  return null;
};

registerEvent(
  "getAchievementNotificationSoundDataUrl",
  getAchievementNotificationSoundDataUrl
);
