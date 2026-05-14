import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem, RomFolder } from "@types";

const rescanEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const current = await emulators.getEmulatorConfig(system);

  const rescanned: RomFolder[] = await Promise.all(
    current.romFolders.map(async (folder) => {
      const scan = await emulators.scanRomFolder(
        folder.path,
        binary,
        folder.scanSubfolders
      );
      return {
        ...folder,
        fileCount: scan.fileCount,
        sizeBytes: scan.sizeBytes,
        lastScanAt: Date.now(),
      };
    })
  );

  return emulators.updateEmulatorConfig(system, (cfg) =>
    emulators.recomputeTotals({ ...cfg, romFolders: rescanned })
  );
};

registerEvent("rescanEmulator", rescanEmulator);
