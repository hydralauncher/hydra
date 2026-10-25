import type { UserPreferences } from "@types";
import { isAchievementSouvenirsEnabled } from "../../../shared/souvenirs.js";

export interface EmulatorAchievementTracking {
  souvenirs: boolean;
  realtimeUnlocks: boolean;
}

export const hasRetroAchievementsCredentials = (
  userPreferences: UserPreferences | null | undefined
) =>
  Boolean(
    userPreferences?.retroAchievementsWebApiKey &&
      userPreferences?.retroAchievementsUsername
  );

export const resolveEmulatorAchievementTracking = (
  userPreferences: UserPreferences | null | undefined,
  hasActiveSubscription: boolean,
  platform: NodeJS.Platform
): EmulatorAchievementTracking => ({
  souvenirs:
    hasActiveSubscription &&
    isAchievementSouvenirsEnabled(
      userPreferences?.enableAchievementSouvenirs,
      platform
    ),
  realtimeUnlocks: hasRetroAchievementsCredentials(userPreferences),
});

export const isEmulatorAchievementTrackingActive = (
  tracking: EmulatorAchievementTracking
) => tracking.souvenirs || tracking.realtimeUnlocks;
