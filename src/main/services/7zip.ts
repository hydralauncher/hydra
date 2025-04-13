import { app } from "electron";
import cp from "node:child_process";
import path from "node:path";
import { logger } from "./logger";

export const binaryName = {
  linux: "7zzs",
  darwin: "7zz",
  win32: "7z.exe",
};

export class SevenZip {
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
    {
      filePath,
      outputPath,
      cwd,
      passwords = [],
    }: {
      filePath: string;
      outputPath?: string;
      cwd?: string;
      passwords?: string[];
    },
    successCb: () => void,
    errorCb: () => void
  ) {
    const tryPassword = (index = -1) => {
      const password = passwords[index] ?? "";
      logger.info(`Trying password ${password} on ${filePath}`);

      const args = ["x", filePath, "-y", "-p" + password];

      if (outputPath) {
        args.push("-o" + outputPath);
      }

      const child = cp.execFile(this.binaryPath, args, {
        cwd,
      });

      child.once("exit", (code) => {
        if (code === 0) {
          successCb();
          return;
        }

        if (index < passwords.length - 1) {
          logger.info(
            `Failed to extract file: ${filePath} with password: ${password}. Trying next password...`
          );

          tryPassword(index + 1);
        } else {
          logger.info(`Failed to extract file: ${filePath}`);

          errorCb();
        }
      });
    };

    tryPassword();
  }
}
