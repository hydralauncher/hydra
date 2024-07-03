import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import path from "path";
import fs from "node:fs";

const windowsStartupPath = path.join(
  app.getPath("appData"),
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup"
);

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  enabled: boolean
) => {
  if (!app.isPackaged) return;

  const appLauncher = new AutoLaunch({
    name: app.getName(),
  });

  if (enabled) {
    appLauncher.enable().catch(() => {});
  } else {
    if (process.platform == "win32") {
      fs.rm(path.join(windowsStartupPath, "Hydra.vbs"), () => {});
    }

    appLauncher.disable().catch(() => {});
  }
};

registerEvent("autoLaunch", autoLaunch);
