import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";
import path from "node:path";

const setEmulatorExecutablePath = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath: string | null
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const normalizedPath = executablePath ? path.normalize(executablePath) : null;
  const resolvedPath = normalizedPath
    ? (emulators.findMacAppBundleRoot(normalizedPath) ?? normalizedPath)
    : null;

  if (resolvedPath && !emulators.isValidEmulatorExecutable(resolvedPath)) {
    return null;
  }

  const version = resolvedPath
    ? emulators.getEmulatorVersion(resolvedPath, binary)
    : null;

  return emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath: resolvedPath,
    detectedVersion: version,
    detectedAt: resolvedPath ? Date.now() : null,
  }));
};

registerEvent("setEmulatorExecutablePath", setEmulatorExecutablePath);
