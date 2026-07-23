import { randomUUID } from "node:crypto";

import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const addRetroArchRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderPath: string,
  scanSubfolders: boolean
) => {
  return retroarch.updateRetroArchConfig((current) => {
    if (current.romFolders.some((f) => f.path === folderPath)) return current;
    return {
      ...current,
      romFolders: [
        ...current.romFolders,
        {
          id: randomUUID(),
          path: folderPath,
          scanSubfolders,
          fileCount: 0,
          sizeBytes: 0,
          lastScanAt: null,
        },
      ],
    };
  });
};

registerEvent("addRetroArchRomFolder", addRetroArchRomFolder);
