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
  preset: string;
  position?: AchievementCustomNotificationPosition;
  width: number;
  height: number;
  scale: number;
  displayTime: number;
  opacity: number;
  background: string;
  titleColor: string;
  descriptionColor: string;
  accentColor: string;
  fontFamily: string;
  iconSize: number;
  radius: number;
  outlineWidth: number;
  outlineColor: string;
  shadow?: string;
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
