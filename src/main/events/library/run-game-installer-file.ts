import { executeGameInstaller } from "../helpers/execute-game-installer";
import { registerEvent } from "../register-event";

const runGameInstallerFile = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
) => {
  return executeGameInstaller(filePath);
};

registerEvent("runGameInstallerFile", runGameInstallerFile);
