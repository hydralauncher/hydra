import fs from "node:fs";
import path from "node:path";
import type {
  AchievementNotificationVariation,
  AchievementNotificationVariationSound,
} from "@types";

const AUDIO_FORMATS = [".wav", ".mp3", ".ogg", ".m4a"];

export const isSupportedAchievementSoundFile = (filePath: string) =>
  AUDIO_FORMATS.includes(path.extname(filePath).toLowerCase());

export const resolveRandomAchievementSoundFromFolder = async (
  folderPath: string
): Promise<string | null> => {
  if (!folderPath || !fs.existsSync(folderPath)) return null;

  const entries = await fs.promises.readdir(folderPath, {
    withFileTypes: true,
  });
  const soundFiles = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(folderPath, entry.name))
    .filter(isSupportedAchievementSoundFile);

  if (!soundFiles.length) return null;

  return soundFiles[Math.floor(Math.random() * soundFiles.length)];
};

export const getStructuredAchievementSoundPath = async (
  sound: AchievementNotificationVariationSound | undefined
): Promise<string | null> => {
  if (!sound || sound.mode === "default" || sound.mode === "muted") {
    return null;
  }

  if (sound.mode === "file") {
    if (
      sound.filePath &&
      fs.existsSync(sound.filePath) &&
      isSupportedAchievementSoundFile(sound.filePath)
    ) {
      return sound.filePath;
    }

    return null;
  }

  if (sound.mode === "folder" && sound.folderPath) {
    return resolveRandomAchievementSoundFromFolder(sound.folderPath);
  }

  return null;
};

export const getVariationSoundAssetName = (
  variation: AchievementNotificationVariation,
  extension: string
) => `achievement-${variation}${extension}`;
