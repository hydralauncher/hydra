import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

import { runLaunchboxImport } from "./import-launchbox-roms";

const rescanEmulator = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  language: string = "en"
) => {
  const current = await emulators.getEmulatorConfig(system);

  if (current.romFolders.length === 0) {
    return emulators.updateEmulatorConfig(system, (cfg) =>
      emulators.recomputeTotals({ ...cfg, romFolders: [] })
    );
  }

  const signal = { cancelled: false };
  await runLaunchboxImport(
    system,
    current.romFolders.map((f) => ({
      path: f.path,
      scanSubfolders: f.scanSubfolders,
    })),
    language,
    signal
  );

  return emulators.getEmulatorConfig(system);
};

registerEvent("rescanEmulator", rescanEmulator);
