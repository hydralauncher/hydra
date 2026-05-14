import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const detectEmulatorEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const result = emulators.detectEmulator(binary);

  return emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath: result?.executablePath ?? current.executablePath,
    detectedVersion: result?.detectedVersion ?? current.detectedVersion,
    detectedAt: result ? Date.now() : current.detectedAt,
  }));
};

registerEvent("detectEmulator", detectEmulatorEvent);
