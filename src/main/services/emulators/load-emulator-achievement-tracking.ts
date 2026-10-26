import type { UserPreferences } from "@types";

import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import { resolveEmulatorAchievementTracking } from "./emulator-achievement-tracking";

export const loadEmulatorAchievementTracking = async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return resolveEmulatorAchievementTracking(
    userPreferences,
    HydraApi.hasActiveSubscription(),
    process.platform
  );
};
