import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

import {
  recomputeRetroArchPlatformCounts,
  reconcileRemovedRetroArchFolder,
} from "./import-retroarch-roms";

const changeRetroArchRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderId: string,
  newPath: string
) => {
  const before = await retroarch.getRetroArchConfig();
  const previous = before.romFolders.find((f) => f.id === folderId);

  const next = await retroarch.updateRetroArchConfig((current) => {
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

  const changed = next.romFolders.some(
    (f) => f.id === folderId && f.path === newPath
  );
  if (previous && changed && previous.path !== newPath) {
    await reconcileRemovedRetroArchFolder(
      previous.path,
      next.romFolders.map((f) => f.path)
    );
    await recomputeRetroArchPlatformCounts();
    return retroarch.getRetroArchConfig();
  }

  return next;
};

registerEvent("changeRetroArchRomFolder", changeRetroArchRomFolder);
