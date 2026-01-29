import { registerEvent } from "../register-event";
import { CommonRedistManager } from "@main/services/common-redist-manager";

const installCommonRedist = async (_event: Electron.IpcMainInvokeEvent) => {
  if (await CommonRedistManager.canInstallCommonRedist()) {
    // Reset preflight status so the user can force a re-run
    await CommonRedistManager.resetPreflightStatus();
    CommonRedistManager.installCommonRedist();
  }
};

registerEvent("installCommonRedist", installCommonRedist);
