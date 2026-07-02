import fs from "node:fs";
import path from "node:path";
import type {
  AchievementNotificationVariation,
  AchievementNotificationVariationSound,
} from "@types";

const AUDIO_FORMATS = new Set([".wav", ".mp3", ".ogg", ".m4a"]);
const ACHIEVEMENT_NOTIFICATION_VARIATIONS = new Set([
  "main",
  "rare",
  "platinum",
] satisfies AchievementNotificationVariation[]);

export const isSupportedAchievementSoundFile = (filePath: string) =>
  AUDIO_FORMATS.has(path.extname(filePath).toLowerCase());

export const isSupportedAchievementNotificationVariation = (
  variation: unknown
): variation is AchievementNotificationVariation =>
  typeof variation === "string" &&
  ACHIEVEMENT_NOTIFICATION_VARIATIONS.has(
    variation as AchievementNotificationVariation
  );

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

  return null;
};

export const getVariationSoundAssetName = (
  variation: AchievementNotificationVariation,
  extension: string
) => {
  if (!isSupportedAchievementNotificationVariation(variation)) {
    throw new Error("Unsupported achievement notification variation");
  }

  const normalizedExtension = extension.toLowerCase();
  if (!AUDIO_FORMATS.has(normalizedExtension)) {
    throw new Error("Unsupported achievement sound file");
  }

  return `achievement-${variation}${normalizedExtension}`;
};
