import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

import {
  recomputeRetroArchPlatformCounts,
  reconcileRemovedRetroArchFolder,
} from "./import-retroarch-roms";

const removeRetroArchRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderId: string
) => {
  const before = await retroarch.getRetroArchConfig();
  const removed = before.romFolders.find((f) => f.id === folderId);

  await retroarch.updateRetroArchConfig((current) =>
    retroarch.recomputeRetroArchTotals({
      ...current,
      romFolders: current.romFolders.filter((f) => f.id !== folderId),
    })
  );

  if (removed) {
    const remaining = before.romFolders
      .filter((f) => f.id !== folderId)
      .map((f) => f.path);
    await reconcileRemovedRetroArchFolder(removed.path, remaining);
  }

  await recomputeRetroArchPlatformCounts();

  return retroarch.getRetroArchConfig();
};

registerEvent("removeRetroArchRomFolder", removeRetroArchRomFolder);
