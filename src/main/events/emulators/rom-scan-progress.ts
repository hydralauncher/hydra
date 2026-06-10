import { randomUUID } from "node:crypto";

import { registerEvent } from "../register-event";
import { emulators, WindowManager } from "@main/services";
import type { EmulatorSystem } from "@types";

const inflight = new Map<string, { cancelled: boolean }>();

const startRomScan = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);

  const binary = emulators.KNOWN_BINARIES[system];
  const channel = `on-rom-scan-progress-${requestId}`;

  void (async () => {
    try {
      const result = await emulators.scanRomFolder(
        folderPath,
        binary,
        scanSubfolders,
        {
          signal,
          onProgress: (p) => {
            WindowManager.mainWindow?.webContents.send(channel, {
              type: "progress",
              ...p,
            });
          },
        }
      );
      WindowManager.mainWindow?.webContents.send(channel, {
        type: signal.cancelled ? "cancelled" : "done",
        fileCount: result.fileCount,
        sizeBytes: result.sizeBytes,
      });
    } catch (err) {
      WindowManager.mainWindow?.webContents.send(channel, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight.delete(requestId);
    }
  })();

  return { requestId };
};

const cancelRomScan = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("startRomScan", startRomScan);
registerEvent("cancelRomScan", cancelRomScan);
