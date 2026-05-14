import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const getEmulatorRomPaths = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const config = await emulators.getEmulatorConfig(system);
  return emulators.readRecursivePaths(system, config.executablePath);
};

const addEmulatorRomPath = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folderPath: string
) => {
  const config = await emulators.getEmulatorConfig(system);
  return emulators.addRecursivePath(system, config.executablePath, folderPath);
};

registerEvent("getEmulatorRomPaths", getEmulatorRomPaths);
registerEvent("addEmulatorRomPath", addEmulatorRomPath);
