import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const changeRetroArchRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderId: string,
  newPath: string
) => {
  return retroarch.updateRetroArchConfig((current) => {
    if (
      current.romFolders.some((f) => f.path === newPath && f.id !== folderId)
    ) {
      return current;
    }

    return retroarch.recomputeRetroArchTotals({
      ...current,
      romFolders: current.romFolders.map((f) =>
        f.id === folderId
          ? {
              ...f,
              path: newPath,
              fileCount: 0,
              sizeBytes: 0,
              lastScanAt: null,
            }
          : f
      ),
    });
  });
};

registerEvent("changeRetroArchRomFolder", changeRetroArchRomFolder);
