import { registerEvent } from "../register-event";
import { emulators, WindowManager } from "@main/services";
import { removeClassicsEmulatorGames } from "@main/helpers/remove-library-game";
import type { EmulatorSystem } from "@types";

const removeEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  options?: { removeGames?: boolean }
) => {
  const config = await emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    executablePath: null,
    detectedVersion: null,
    detectedAt: null,
    biosPath: null,
    romFolders: [],
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: 0,
  }));

  if (options?.removeGames) {
    const removed = await removeClassicsEmulatorGames({
      kind: "emulator",
      system,
    });
    if (removed > 0)
      WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return config;
};

registerEvent("removeEmulator", removeEmulator);
