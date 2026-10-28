import { registerEvent } from "../register-event";
import { retroarch, WindowManager } from "@main/services";
import { removeClassicsEmulatorGames } from "@main/helpers/remove-library-game";

const removeRetroArch = async (
  _event: Electron.IpcMainInvokeEvent,
  options?: { removeGames?: boolean }
) => {
  const config = await retroarch.updateRetroArchConfig((current) => ({
    ...current,
    executablePath: null,
    detectedVersion: null,
    detectedAt: null,
    romFolders: [],
    perPlatformCounts: { nes: 0, snes: 0, n64: 0, gb: 0, gbc: 0, gba: 0 },
    lastScanAt: null,
    totalFiles: 0,
    totalSizeBytes: 0,
  }));

  if (options?.removeGames) {
    const removed = await removeClassicsEmulatorGames({ kind: "retroarch" });
    if (removed > 0)
      WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  return config;
};

registerEvent("removeRetroArch", removeRetroArch);
