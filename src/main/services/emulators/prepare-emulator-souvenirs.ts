import type { UserPreferences } from "@types";
import { isAchievementSouvenirsEnabled } from "@shared";

import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import {
  createRetroArchSouvenirSession,
  enableDuckStationFileLogging,
} from "./emulator-souvenir-config";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";

export const prepareEmulatorSouvenirs = async (
  system: EmulatorSessionSystem,
  executablePath: string | null
) => {
  if (!HydraApi.hasActiveSubscription()) return null;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (
    !isAchievementSouvenirsEnabled(
      userPreferences?.enableAchievementSouvenirs,
      process.platform
    )
  ) {
    return null;
  }

  if (system === "ps1") {
    await enableDuckStationFileLogging();
    return null;
  }

  if (system === "ps2" || system === "ps3") return null;

  if (executablePath) {
    return createRetroArchSouvenirSession();
  }

  return null;
};
