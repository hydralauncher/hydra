import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorConfig, EmulatorSystem } from "@types";
import path from "node:path";
import {
  getCredentialEmulatorForSystem,
  syncRetroAchievementsEmulatorCredentials,
} from "@main/services/retro-achievements/emulator-credentials/emulator-credential-sync";

const setEmulatorExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string | null
): Promise<EmulatorConfig | null> => {
  const binary = emulators.KNOWN_BINARIES[system];
  const normalizedPath = executablePath ? path.normalize(executablePath) : null;
  const resolvedPath = normalizedPath
    ? (emulators.findMacAppBundleRoot(normalizedPath) ?? normalizedPath)
    : null;

  if (
    resolvedPath &&
    !emulators.isValidEmulatorExecutableForBinary(resolvedPath, binary)
  ) {
    return null;
  }

  const version = resolvedPath
    ? emulators.getEmulatorVersion(resolvedPath, binary)
    : null;

  // Version detection can take a few seconds. The executable may be moved
  // while the probe is running, so validate it again before persisting it.
  if (
    resolvedPath &&
    !emulators.isValidEmulatorExecutableForBinary(resolvedPath, binary)
  ) {
    return null;
  }

  const config = await emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath: resolvedPath,
    detectedVersion: version,
    detectedAt: resolvedPath ? Date.now() : null,
  }));

  if (resolvedPath) {
    void syncRetroAchievementsEmulatorCredentials(
      getCredentialEmulatorForSystem(system)
    );
  }

  return config;
};

registerEvent("setEmulatorExecutablePath", setEmulatorExecutablePath);
