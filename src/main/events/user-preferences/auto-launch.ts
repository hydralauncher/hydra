import { windowsStartupPath } from "@main/constants";
import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  enabled: boolean
) => {
  if (!app.isPackaged) return;

  if (process.platform == "win32") {
    const destination = path.join(windowsStartupPath, "hydralauncher.vbs");

    if (enabled) {
      const scriptPath = path.join(process.resourcesPath, "hydralauncher.vbs");

      fs.copyFileSync(scriptPath, destination);
    } else {
      fs.rmSync(destination);
    }
  } else {
    const appLauncher = new AutoLaunch({
      name: app.getName(),
    });
    if (enabled) {
      appLauncher.enable().catch();
    } else {
      appLauncher.disable().catch();
    }
  }
};

registerEvent("autoLaunch", autoLaunch);
