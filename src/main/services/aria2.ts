import path from "node:path";
import cp from "node:child_process";
import { app } from "electron";

export class Aria2 {
  private static process: cp.ChildProcess | null = null;
  private static readonly binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, "aria2", "aria2c")
    : path.join(__dirname, "..", "..", "aria2", "aria2c");

  public static spawn() {
    this.process = cp.spawn(
      this.binaryPath,
      [
        "--enable-rpc",
        "--rpc-listen-all",
        "--file-allocation=none",
        "--allow-overwrite=true",
        "--disk-cache=64M",
      ],
      { stdio: "inherit", windowsHide: true }
    );
  }

  public static kill() {
    this.process?.kill();
  }
}
