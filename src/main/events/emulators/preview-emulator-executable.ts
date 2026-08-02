import { registerEvent } from "../register-event";
import { emulators, CrossOver } from "@main/services";
import type { EmulatorSystem } from "@types";
import path from "node:path";

interface PreviewResult {
  executablePath: string;
  detectedVersion: string | null;
}

const previewEmulatorExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath?: string | null
): Promise<PreviewResult | null> => {
  // Special handling for CrossOver on macOS
  if (system === "windows" && process.platform === "darwin") {
    if (executablePath) {
      return {
        executablePath: path.normalize(executablePath),
        detectedVersion: CrossOver.getVersion(),
      };
    }

    if (CrossOver.isInstalled()) {
      return {
        executablePath: CrossOver.getAppPath(),
        detectedVersion: CrossOver.getVersion(),
      };
    }

    return null;
  }

  const binary = emulators.KNOWN_BINARIES[system];

  if (executablePath) {
    const normalizedPath = path.normalize(executablePath);
    const resolvedPath =
      emulators.findMacAppBundleRoot(normalizedPath) ?? normalizedPath;

    if (!emulators.isValidEmulatorExecutable(resolvedPath)) return null;

    return {
      executablePath: resolvedPath,
      detectedVersion: emulators.getEmulatorVersion(resolvedPath, binary),
    };
  }

  const result = emulators.detectEmulator(binary, { resolveVersion: true });
  if (!result) return null;

  return {
    executablePath: result.executablePath,
    detectedVersion: result.detectedVersion,
  };
};

registerEvent("previewEmulatorExecutable", previewEmulatorExecutable);
