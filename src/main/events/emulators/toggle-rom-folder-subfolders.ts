import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem, RomFolder } from "@types";

const toggleRomFolderSubfolders = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderId: string,
  scanSubfolders: boolean
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const current = await emulators.getEmulatorConfig(system);
  const folder = current.romFolders.find((f) => f.id === folderId);
  if (!folder) return current;

  const scan = await emulators.scanRomFolder(
    folder.path,
    binary,
    scanSubfolders
  );

  const next: RomFolder = {
    ...folder,
    scanSubfolders,
    fileCount: scan.fileCount,
    sizeBytes: scan.sizeBytes,
    lastScanAt: Date.now(),
  };

  return emulators.updateEmulatorConfig(system, (cfg) =>
    emulators.recomputeTotals({
      ...cfg,
      romFolders: cfg.romFolders.map((f) => (f.id === folderId ? next : f)),
    })
  );
};

registerEvent("toggleRomFolderSubfolders", toggleRomFolderSubfolders);
