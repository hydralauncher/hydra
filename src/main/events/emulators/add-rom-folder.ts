import { randomUUID } from "node:crypto";
import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem, RomFolder } from "@types";

const addRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const scan = await emulators.scanRomFolder(
    folderPath,
    binary,
    scanSubfolders
  );

  const folder: RomFolder = {
    id: randomUUID(),
    path: folderPath,
    scanSubfolders,
    fileCount: scan.fileCount,
    sizeBytes: scan.sizeBytes,
    lastScanAt: Date.now(),
  };

  return emulators.updateEmulatorConfig(system, (current) => {
    if (current.romFolders.some((f) => f.path === folderPath)) {
      return current;
    }
    return emulators.recomputeTotals({
      ...current,
      romFolders: [...current.romFolders, folder],
    });
  });
};

registerEvent("addRomFolder", addRomFolder);
