import { registerEvent } from "../register-event";
import { existsSync } from "node:fs";
import { emulators, CrossOver } from "@main/services";
import type { EmulatorSystem } from "@types";

const detectEmulatorEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  // Special handling for CrossOver on macOS
  if (system === "windows" && process.platform === "darwin") {
    const crossoverInfo = CrossOver.detect();
    return emulators.updateEmulatorConfig(system, (current) => {
      if (crossoverInfo.installed) {
        return {
          ...current,
          executablePath: crossoverInfo.appPath,
          detectedVersion: crossoverInfo.version ?? current.detectedVersion,
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
  }

  const binary = emulators.KNOWN_BINARIES[system];
  const result = emulators.detectEmulator(binary, { resolveVersion: true });

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
