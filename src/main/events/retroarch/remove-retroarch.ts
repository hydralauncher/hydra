import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const removeRetroArch = async (_event: Electron.IpcMainInvokeEvent) => {
  return retroarch.updateRetroArchConfig((current) => ({
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
};

registerEvent("removeRetroArch", removeRetroArch);
