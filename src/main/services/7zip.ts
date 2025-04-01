import { app } from "electron";
import cp from "node:child_process";
import path from "node:path";

export const binaryName = {
  linux: "7zzs",
  darwin: "7zz",
  win32: "7zr.exe",
};

export class _7Zip {
  private static readonly binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, binaryName[process.platform])
    : path.join(
        __dirname,
        "..",
        "..",
        "binaries",
        binaryName[process.platform]
      );

  public static extractFile(
    filePath: string,
    outputPath: string,
    cb: () => void
  ) {
    const child = cp.spawn(this.binaryPath, [
      "x",
      filePath,
      "-o" + outputPath,
      "-y",
    ]);

    child.on("exit", () => {
      cb();
    });
  }
}
