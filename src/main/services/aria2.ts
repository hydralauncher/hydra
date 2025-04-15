import path from "node:path";
import cp from "node:child_process";
import { app } from "electron";

export const startAria2 = () => {};

export class Aria2 {
  private static process: cp.ChildProcess | null = null;

  public static spawn() {
    const binaryPath = app.isPackaged
      ? path.join(process.resourcesPath, "aria2", "aria2c")
      : path.join(__dirname, "..", "..", "aria2", "aria2c");

    this.process = cp.spawn(
      binaryPath,
      [
        "--enable-rpc",
        "--rpc-listen-all",
        "--file-allocation=none",
        "--allow-overwrite=true",
      ],
      { stdio: "inherit", windowsHide: true }
    );
  }

  public static kill() {
    this.process?.kill();
  }
}
