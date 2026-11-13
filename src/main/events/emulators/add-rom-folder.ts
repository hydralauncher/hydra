import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

import { runLaunchboxImport } from "./import-launchbox-roms";

const addRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean,
  language: string = "en"
) => {
  const current = await emulators.getEmulatorConfig(system);
  if (current.romFolders.some((f) => f.path === folderPath)) {
    return { config: current, unsupportedPackages: 0 };
  }

  const signal = { cancelled: false };
  const { unsupportedPackages } = await runLaunchboxImport(
    system,
    [{ path: folderPath, scanSubfolders }],
    language,
    signal
  );

  return {
    config: await emulators.getEmulatorConfig(system),
    unsupportedPackages,
  };
};

registerEvent("addRomFolder", addRomFolder);
