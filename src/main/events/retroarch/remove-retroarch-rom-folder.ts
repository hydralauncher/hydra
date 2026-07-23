import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

import { recomputeRetroArchPlatformCounts } from "./import-retroarch-roms";

const removeRetroArchRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  folderId: string
) => {
  await retroarch.updateRetroArchConfig((current) =>
    retroarch.recomputeRetroArchTotals({
      ...current,
      romFolders: current.romFolders.filter((f) => f.id !== folderId),
    })
  );

  await recomputeRetroArchPlatformCounts();

  return retroarch.getRetroArchConfig();
};

registerEvent("removeRetroArchRomFolder", removeRetroArchRomFolder);
