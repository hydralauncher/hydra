import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

import { ensureRomFolderRegistered } from "./import-launchbox-roms";

const registerRomFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean
) => {
  await ensureRomFolderRegistered(system, folderPath, scanSubfolders);
  return emulators.getEmulatorConfig(system);
};

registerEvent("registerRomFolder", registerRomFolder);
