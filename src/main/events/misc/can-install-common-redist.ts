import { registerEvent } from "../register-event";
import { CommonRedistManager } from "@main/services/common-redist-manager";

const canInstallCommonRedist = async (_event: Electron.IpcMainInvokeEvent) =>
  CommonRedistManager.canInstallCommonRedist();

registerEvent("canInstallCommonRedist", canInstallCommonRedist);
