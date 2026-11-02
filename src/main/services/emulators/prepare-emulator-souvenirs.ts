import {
  createDolphinSouvenirSession,
  createPPSSPPSouvenirSession,
  createRetroArchSouvenirSession,
  enableDuckStationFileLogging,
} from "./emulator-souvenir-config";
import type { EmulatorSessionSystem } from "./emulator-session-tracker";
import { isEmulatorAchievementTrackingActive } from "./emulator-achievement-tracking";
import { loadEmulatorAchievementTracking } from "./load-emulator-achievement-tracking";
import {
  getCredentialEmulatorForSystem,
  syncRetroAchievementsEmulatorCredentials,
} from "../retro-achievements/emulator-credentials/emulator-credential-sync";

export const prepareEmulatorSouvenirs = async (
  system: EmulatorSessionSystem,
  executablePath: string | null
) => {
  await syncRetroAchievementsEmulatorCredentials(
    getCredentialEmulatorForSystem(system)
  );

  const tracking = await loadEmulatorAchievementTracking();
  if (!isEmulatorAchievementTrackingActive(tracking)) return null;

  if (system === "ps1") {
    await enableDuckStationFileLogging();
    return null;
  }

  if (system === "ps2" || system === "ps3") {
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
