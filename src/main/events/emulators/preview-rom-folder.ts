import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const previewRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  const binary = emulators.KNOWN_BINARIES[system];
  const { fileCount, sizeBytes } = await emulators.scanRomFolder(
    folderPath,
    binary,
    scanSubfolders
  );
  return { fileCount, sizeBytes };
};

registerEvent("previewRomFolder", previewRomFolder);
