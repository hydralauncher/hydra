import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

import { startTrackedRetroArchImport } from "./import-retroarch-roms";

const rescanRetroArch = async (
  _event: Electron.IpcMainInvokeEvent,
  language: string = "en"
) => {
  const current = await retroarch.getRetroArchConfig();

  if (current.romFolders.length === 0) {
    return retroarch.updateRetroArchConfig((cfg) =>
      retroarch.recomputeRetroArchTotals({ ...cfg, romFolders: [] })
    );
  }

  const tracked = startTrackedRetroArchImport(
    current.romFolders.map((f) => ({
      path: f.path,
      scanSubfolders: f.scanSubfolders,
    })),
    language
  );
  await tracked.done;

  return retroarch.getRetroArchConfig();
};

registerEvent("rescanRetroArch", rescanRetroArch);
