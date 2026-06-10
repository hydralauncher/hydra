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

// RPCS3 default discovery sources: the config root's `games/` folder and the
// title-id entries already registered in games.yml.
const getRpcs3DefaultSources = async () => {
  const config = await emulators.getEmulatorConfig("ps3");
  const exe = config.executablePath;
  const ymlMap = await emulators.readGamesYml(exe);
  return {
    gamesDir: emulators.findExistingConfig(
      emulators.rpcs3DefaultGamesDirs(exe)
    ),
    gamesYmlPath: emulators.findExistingConfig(
      emulators.rpcs3GamesYmlCandidates(exe)
    ),
    gamesYmlEntries: Array.from(ymlMap.entries()).map(([titleId, path]) => ({
      titleId,
      path,
    })),
  };
};

registerEvent("getEmulatorRomPaths", getEmulatorRomPaths);
registerEvent("addEmulatorRomPath", addEmulatorRomPath);
registerEvent("getRpcs3DefaultSources", getRpcs3DefaultSources);
