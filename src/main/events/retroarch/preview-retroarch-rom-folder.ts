import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const previewRetroArchRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string,
  scanSubfolders: boolean
): Promise<{ fileCount: number }> => {
  const roms = await retroarch.scanRetroArchFolder({
    path: folderPath,
    scanSubfolders,
  });
  return { fileCount: roms.length };
};

registerEvent("previewRetroArchRomFolder", previewRetroArchRomFolder);
