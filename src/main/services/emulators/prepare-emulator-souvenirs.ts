import type { UserPreferences } from "@types";

import { db, levelKeys } from "@main/level";
import { HydraApi } from "../hydra-api";
import {
  enableDuckStationFileLogging,
  enableRetroArchAchievementScreenshots,
} from "./emulator-souvenir-config";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";

export const prepareEmulatorSouvenirs = async (
  system: EmulatorSessionSystem,
  executablePath: string | null
) => {
  if (process.platform === "linux") return;
  if (!HydraApi.hasActiveSubscription()) return;

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (userPreferences?.enableAchievementSouvenirs !== true) return;

  if (system === "ps1") {
    enableDuckStationFileLogging();
    return;
  }

  if (system === "ps2" || system === "ps3") return;

  if (executablePath) {
    await enableRetroArchAchievementScreenshots(executablePath);
  }
};
