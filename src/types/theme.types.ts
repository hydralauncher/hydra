import type { AchievementCustomNotificationPosition } from "./level.types";

export interface Theme {
  id: string;
  name: string;
  author?: string;
  authorName?: string;
  isActive: boolean;
  code: string;
  hasCustomSound?: boolean;
  originalSoundPath?: string;
  achievementNotificationCustomizerActive?: boolean;
  achievementNotificationCustomizer?: AchievementNotificationCustomizer;
  createdAt: Date;
  updatedAt: Date;
}

export type AchievementNotificationVariation = "main" | "rare" | "platinum";

export type AchievementNotificationSoundMode = "default" | "file" | "muted";

export interface AchievementNotificationVariationSound {
  mode: AchievementNotificationSoundMode;
  filePath?: string;
  volume?: number;
}

export interface AchievementNotificationVariationStyle {
  position?: AchievementCustomNotificationPosition;
  scale: number;
  displayTime: number;
  opacity: number;
  background: string;
  titleColor: string;
  descriptionColor: string;
  accentColor: string;
  radius: number;
  outlineWidth: number;
  outlineColor: string;
  shadowColor: string;
  shadowIntensity: number;
}

export interface AchievementNotificationCustomizer {
  version: 1;
  variations: Record<
    AchievementNotificationVariation,
    AchievementNotificationVariationStyle
  >;
  sounds?: Partial<
    Record<
      AchievementNotificationVariation,
      AchievementNotificationVariationSound
    >
  >;
}
