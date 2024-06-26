import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";

export const startAria2 = () => {
  const binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, "aria2", "aria2c")
    : path.join(__dirname, "..", "..", "aria2", "aria2c");

  const aria2Process = spawn(
    binaryPath,
    [
      "--enable-rpc",
      "--rpc-listen-all",
      "--file-allocation=none",
      "--allow-overwrite=true",
      "--log-level=debug",
      "--no-conf",
      "--disk-cache=128M",
      "-x16",
      "-s16",
    ],
    { stdio: "inherit", windowsHide: true }
  );

  aria2Process.on("error", (err) => {
    console.error("Aria2 process error:", err);
  });

  aria2Process.on("exit", (code, signal) => {
    if (code !== 0) {
      console.error(
        `Aria2 process exited with code ${code} and signal ${signal}`
      );
    } else {
      console.log("Aria2 process exited successfully");
    }
  });

  return aria2Process;
};
