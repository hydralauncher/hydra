import { registerEvent } from "../register-event";
import { UpdateManager } from "@main/services/update-manager";

const checkForUpdates = async (_event: Electron.IpcMainInvokeEvent) => {
  return UpdateManager.checkForUpdates();
};

registerEvent("checkForUpdates", checkForUpdates);
