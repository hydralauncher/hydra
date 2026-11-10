import {
  createDolphinSouvenirSession,
  createPPSSPPSouvenirSession,
  createRetroArchSouvenirSession,
  enableDuckStationFileLogging,
} from "./emulator-souvenir-config";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";
import { getEmulatorConfig } from "./emulators-repository";
import { createRpcs3SessionConfig } from "./rpcs3-session-config";
import { logger } from "../logger";
import { HydraApi } from "../hydra-api";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";
import {
  isEmulatorAchievementTrackingActive,
  needsEmulatorOverlayVisibility,
  resolveEmulatorAchievementTracking,
} from "./emulator-achievement-tracking";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";
import {
  getCredentialEmulatorForSystem,
  syncRetroAchievementsEmulatorCredentials,
} from "../retro-achievements/emulator-credentials/emulator-credential-sync";

const shouldKeepRpcs3Borderless = async () => {
  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  return needsEmulatorOverlayVisibility(
    userPreferences,
    resolveEmulatorAchievementTracking(
      userPreferences,
      HydraApi.hasActiveSubscription(),
      process.platform
    )
  );
};

const createRpcs3Session = async (titleId: string | null) => {
  try {
    if (!(await shouldKeepRpcs3Borderless())) return null;

    const config = await getEmulatorConfig("ps3");
    const sessionConfig = await createRpcs3SessionConfig(
      config.executablePath,
      config.rpcs3ConfigRoot,
      titleId
    );
    if (!sessionConfig) return null;

    return {
      kind: "rpcs3" as const,
      launchArguments: sessionConfig.launchArguments,
      logPath: null,
      logOffset: null,
      sessionDirectory: null,
      cleanupFilePaths: sessionConfig.cleanupFilePaths,
    };
  } catch (error) {
    logger.error("Failed to prepare RPCS3 session config", error);
    return null;
  }
};

export const prepareEmulatorSouvenirs = async (
  system: EmulatorSessionSystem,
  executablePath: string | null,
  titleId: string | null = null
) => {
  if (system === "ps3") return createRpcs3Session(titleId);

  await syncRetroAchievementsEmulatorCredentials(
    getCredentialEmulatorForSystem(system)
  );

  const tracking = await loadEmulatorAchievementTracking();
  if (!isEmulatorAchievementTrackingActive(tracking)) return null;

  if (system === "ps1") {
    await enableDuckStationFileLogging();
    return null;
  }

  if (system === "ps2" || system === "ps4") {
    return null;
  }

  if (system === "psp" && executablePath) {
    return createPPSSPPSouvenirSession(executablePath);
  }

  if (system === "dolphin" && executablePath) {
    return createDolphinSouvenirSession(executablePath);
  }

  if (executablePath) {
    return createRetroArchSouvenirSession(executablePath);
  }

  return null;
};
