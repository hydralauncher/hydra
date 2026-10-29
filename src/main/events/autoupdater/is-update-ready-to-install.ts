import { registerEvent } from "../register-event";
import { UpdateManager } from "@main/services/update-manager";

const isUpdateReadyToInstall = async (_event: Electron.IpcMainInvokeEvent) => {
  return UpdateManager.isUpdateReadyToInstall();
};

registerEvent("isUpdateReadyToInstall", isUpdateReadyToInstall);
