import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

import { runRetroArchImport } from "./import-retroarch-roms";

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

  const signal = { cancelled: false };
  await runRetroArchImport(
    current.romFolders.map((f) => ({
      path: f.path,
      scanSubfolders: f.scanSubfolders,
    })),
    language,
    signal
  );

  return retroarch.getRetroArchConfig();
};

registerEvent("rescanRetroArch", rescanRetroArch);
