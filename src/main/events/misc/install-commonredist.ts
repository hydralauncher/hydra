import { app } from "electron";
import path from "node:path";
import cp from "node:child_process";
import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const installScriptPath = app.isPackaged
  ? path.join(process.resourcesPath, "commonredist", "install.bat")
  : path.join(
      __dirname,
      "..",
      "..",
      "resources",
      "commonredist",
      "install.bat"
    );

const installCommonRedist = async (_event: Electron.IpcMainInvokeEvent) => {
  cp.execFile(installScriptPath, (error) => {
    if (error) {
      logger.error(error);
    }
  });
};

registerEvent("installCommonRedist", installCommonRedist);
