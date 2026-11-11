import {
  createDolphinSouvenirSession,
  createPPSSPPSouvenirSession,
  createRetroArchSouvenirSession,
  enableDuckStationFileLogging,
} from "./emulator-souvenir-config";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";
import { getEmulatorConfig } from "./emulators-repository";
import { createRpcs3SessionConfig } from "./rpcs3-session-config";
import { resolveRpcs3TrophySources } from "./rpcs3-trophy-sources";
import { logger } from "../logger";
import { HydraApi } from "../hydra-api";
import { db, levelKeys } from "@main/level";
import type { Game, UserPreferences } from "@types";
import { rpcs3TitleIdsForGame } from "../cloud-save/rpcs3-title-ids";
import { extractVerifiedPs3TitleId } from "./extract-disc-sku";
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

const resolveRpcs3TitleIds = async (
  game: Game | undefined,
  bootTarget: string | undefined
): Promise<string[]> => {
  const bootTitleId = bootTarget
    ? await extractVerifiedPs3TitleId(bootTarget).catch(() => null)
    : null;
  return [
    ...(bootTitleId ? [bootTitleId] : []),
    ...(game ? rpcs3TitleIdsForGame(game) : []),
  ];
};

const createRpcs3Session = async (
  game: Game | undefined,
  bootTarget: string | undefined
) => {
  try {
    if (!game || !(await shouldKeepRpcs3Borderless())) return null;
    if (!(await resolveRpcs3TrophySources(game, bootTarget))) return null;

    const config = await getEmulatorConfig("ps3");
    const sessionConfig = await createRpcs3SessionConfig(
      config.executablePath,
      config.rpcs3ConfigRoot,
      await resolveRpcs3TitleIds(game, bootTarget)
    );
    if (!sessionConfig) return null;

    return {
      kind: "rpcs3" as const,
      launchArguments: sessionConfig.launchArguments,
      logPath: null,
      logOffset: null,
      sessionDirectory: sessionConfig.sessionDirectory,
      cleanupFilePaths: [],
    };
  } catch (error) {
    logger.error("Failed to prepare RPCS3 session config", error);
    return null;
  }
};

export const prepareEmulatorSouvenirs = async (
  system: EmulatorSessionSystem,
  executablePath: string | null,
  { game, bootTarget }: { game?: Game; bootTarget?: string } = {}
) => {
  if (system === "ps3") return createRpcs3Session(game, bootTarget);

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
