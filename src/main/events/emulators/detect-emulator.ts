import { registerEvent } from "../register-event";
import { existsSync } from "node:fs";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const detectEmulatorEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const result = emulators.detectEmulator(binary);

  return emulators.updateEmulatorConfig(system, (current) => {
    if (result) {
      return {
        ...current,
        executablePath: result.executablePath,
        detectedVersion: result.detectedVersion ?? current.detectedVersion,
        detectedAt: Date.now(),
      };
    }

    const currentStillValid =
      current.executablePath !== null && existsSync(current.executablePath);

    return {
      ...current,
      executablePath: currentStillValid ? current.executablePath : null,
      detectedVersion: currentStillValid ? current.detectedVersion : null,
      detectedAt: currentStillValid ? current.detectedAt : null,
    };
  });
};

registerEvent("detectEmulator", detectEmulatorEvent);
