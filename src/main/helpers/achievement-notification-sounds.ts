import path from "node:path";
import type {
  AchievementNotificationSound,
  AchievementNotificationVariation,
  Theme,
} from "@types";

const AUDIO_FORMATS = new Set([".wav", ".mp3", ".ogg", ".m4a"]);
const ACHIEVEMENT_NOTIFICATION_VARIATIONS = new Set([
  "default",
  "rare",
  "hidden",
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

  return variation === "default"
    ? `achievement${normalizedExtension}`
    : `achievement-${variation}${normalizedExtension}`;
};

export const getEffectiveThemeAchievementSound = (
  theme: Pick<
    Theme,
    "achievementSounds" | "hasCustomSound" | "originalSoundPath"
  >,
  variation: AchievementNotificationVariation
): AchievementNotificationSound => {
  const base = theme.achievementSounds?.default ?? {
    mode: theme.hasCustomSound ? "file" : "default",
    originalPath: theme.originalSoundPath,
  };
  if (variation === "default") return base;

  const variationSound = theme.achievementSounds?.[variation];
  return !variationSound || variationSound.mode === "inherit"
    ? base
    : variationSound;
};
