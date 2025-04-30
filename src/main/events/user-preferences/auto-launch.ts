import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import path from "path";
import fs from "node:fs";
import { logger } from "@main/services";
import { SystemPath } from "@main/services/system-path";

const windowsStartupPath = path.join(
  SystemPath.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup"
);

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
    if (process.platform == "win32") {
      fs.rm(path.join(windowsStartupPath, "Hydra.vbs"), () => {});
    }

    appLauncher.disable().catch((err) => {
      logger.error(err);
    });
  }
};

registerEvent("autoLaunch", autoLaunch);
