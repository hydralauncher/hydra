import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

interface PreviewResult {
  executablePath: string;
  detectedVersion: string | null;
}

const previewEmulatorExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  executablePath?: string | null
): Promise<PreviewResult | null> => {
  const binary = emulators.KNOWN_BINARIES[system];

  if (executablePath) {
    if (!emulators.isValidEmulatorExecutable(executablePath)) return null;
    return {
      executablePath,
      detectedVersion: emulators.getEmulatorVersion(executablePath, binary),
    };
  }

  const result = emulators.detectEmulator(binary);
  if (!result) return null;

  return {
    executablePath: result.executablePath,
    detectedVersion: result.detectedVersion,
  };
};

registerEvent("previewEmulatorExecutable", previewEmulatorExecutable);
