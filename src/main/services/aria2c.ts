import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";
import { logger } from "./logger";

export const startAria2 = () => {
  const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, "aria2", "aria2c")
    : path.join(__dirname, "..", "..", "aria2", "aria2c");

  logger.info("startAria2 on:", binaryPath);

  return spawn(
    binaryPath,
    [
      "--enable-rpc",
      "--rpc-listen-all",
      "--file-allocation=none",
      "--allow-overwrite=true",
    ],
    { stdio: "inherit", windowsHide: true }
  );
};
