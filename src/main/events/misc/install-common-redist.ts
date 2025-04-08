import { registerEvent } from "../register-event";
import { CommonRedistManager } from "@main/services/common-redist-manager";

const installCommonRedist = async (_event: Electron.IpcMainInvokeEvent) => {
  if (await CommonRedistManager.canInstallCommonRedist()) {
    CommonRedistManager.installCommonRedist();
  }
};

registerEvent("installCommonRedist", installCommonRedist);
