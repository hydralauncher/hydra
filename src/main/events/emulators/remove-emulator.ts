import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const removeEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  return emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath: null,
    detectedVersion: null,
    detectedAt: null,
    romFolders: [],
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: 0,
  }));
};

registerEvent("removeEmulator", removeEmulator);
