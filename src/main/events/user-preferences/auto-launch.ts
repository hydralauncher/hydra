import { windowsStartupPath } from "@main/constants";
import { registerEvent } from "../register-event";
import AutoLaunch from "auto-launch";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const getVbsFileContent = (exePath: string) => {
  return `On Error Resume Next
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${exePath}""", 0 'Must quote command if it has spaces; must escape quotes
Set WshShell = Nothing
`;
};

const autoLaunch = async (
  _event: Electron.IpcMainInvokeEvent,
  enabled: boolean
) => {
  if (!app.isPackaged) return;

  const appLauncher = new AutoLaunch({
    name: app.getName(),
  });

  if (process.platform == "win32") {
    const destination = path.join(windowsStartupPath, "Hydra.vbs");

    if (enabled) {
      const vbsFileContent = getVbsFileContent(app.getPath("exe"));
      fs.writeFileSync(destination, vbsFileContent);
    } else {
      appLauncher.disable().catch();
      fs.rmSync(destination);
    }
  } else {
    if (enabled) {
      appLauncher.enable().catch();
    } else {
      appLauncher.disable().catch();
    }
  }
};

registerEvent("autoLaunch", autoLaunch);
