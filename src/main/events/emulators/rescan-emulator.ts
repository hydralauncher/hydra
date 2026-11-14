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
    const config = await emulators.updateEmulatorConfig(system, (cfg) =>
      emulators.recomputeTotals({ ...cfg, romFolders: [] })
    );
    return { config, unsupportedPackages: 0 };
  }

  const signal = { cancelled: false };
  const { unsupportedPackages } = await runLaunchboxImport(
    system,
    current.romFolders.map((f) => ({
      path: f.path,
      scanSubfolders: f.scanSubfolders,
    })),
    language,
    signal
  );

  return {
    config: await emulators.getEmulatorConfig(system),
    unsupportedPackages,
  };
};

registerEvent("rescanEmulator", rescanEmulator);
