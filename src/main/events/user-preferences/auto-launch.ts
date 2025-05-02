import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import { logger } from "@main/services";

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  autoLaunchProps: { enabled: boolean; minimized: boolean }
) => {
  if (!app.isPackaged) return;

  const appLauncher = new AutoLaunch({
    name: app.getName(),
    isHidden: autoLaunchProps.minimized,
  });

  if (autoLaunchProps.enabled) {
    appLauncher.enable().catch((err) => {
      logger.error(err);
    });
  } else {
    appLauncher.disable().catch((err) => {
      logger.error(err);
    });
  }
};

registerEvent("autoLaunch", autoLaunch);
