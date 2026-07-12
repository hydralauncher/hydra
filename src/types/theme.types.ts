export interface Theme {
  id: string;
  name: string;
  author?: string;
  authorName?: string;
  isActive: boolean;
  code: string;
  hasCustomSound?: boolean;
  originalSoundPath?: string;
  achievementSounds?: Partial<
    Record<AchievementNotificationVariation, AchievementNotificationSound>
  >;
  createdAt: Date;
  updatedAt: Date;
}

export type AchievementNotificationVariation =
  | "default"
  | "rare"
  | "hidden"
  | "platinum";

export type AchievementNotificationSoundMode =
  | "default"
  | "inherit"
  | "file"
  | "muted";

export interface AchievementNotificationSound {
  mode: AchievementNotificationSoundMode;
  originalPath?: string;
  volume?: number;
}
