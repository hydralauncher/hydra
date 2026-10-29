import { registerEvent } from "../register-event";
import { UpdateManager } from "@main/services/update-manager";

const isUpdateReadyToInstall = (_event: Electron.IpcMainInvokeEvent) =>
  UpdateManager.isUpdateReadyToInstall();

registerEvent("isUpdateReadyToInstall", isUpdateReadyToInstall);
