import type { UserPreferences } from "@types";

export type CombinedAchievementNotificationMode = "none" | "custom" | "system";

export const getCombinedAchievementNotificationMode = (
  preferences:
    | Pick<
        UserPreferences,
        | "achievementNotificationsEnabled"
        | "achievementCustomNotificationsEnabled"
      >
    | null
    | undefined,
  platform: NodeJS.Platform
): CombinedAchievementNotificationMode => {
  if (preferences?.achievementNotificationsEnabled === false) return "none";

  return preferences?.achievementCustomNotificationsEnabled !== false &&
    platform === "win32"
    ? "custom"
    : "system";
};
