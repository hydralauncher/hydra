import { commonRedistPath } from "@main/constants";
import axios from "axios";
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { SystemPath } from "./system-path";

export class CommonRedistManager {
  private static readonly redistributables = [
    "dotNetFx40_Full_setup.exe",
    "directx_Jun2010_redist.exe",
    "oalinst.exe",
    "install.bat",
    "xnafx40_redist.msi",
    "VisualCppRedist_AIO_x86_x64.exe",
  ];
  private static readonly installationTimeout = 1000 * 60 * 5; // 5 minutes
  private static readonly installationLog = path.join(
    SystemPath.getPath("temp"),
    "common_redist_install.log"
  );

  public static async installCommonRedist() {
    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
      logger.error("Installation timed out");

      WindowManager.mainWindow?.webContents.send("common-redist-progress", {
        log: "Installation timed out",
        complete: false,
      });
    }, this.installationTimeout);

    const installationCompleteMessage = "Installation complete";

    if (!fs.existsSync(this.installationLog)) {
      await fs.promises.writeFile(this.installationLog, "");
    }

    fs.watch(this.installationLog, { signal: abortController.signal }, () => {
      fs.readFile(this.installationLog, "utf-8", (err, data) => {
        if (err) return logger.error("Error reading log file:", err);

        logger.log("Redist log file updated:", data);

        const tail = data.split("\n").at(-2)?.trim();

        if (tail?.includes(installationCompleteMessage)) {
          clearTimeout(timeout);
          if (!abortController.signal.aborted) {
            abortController.abort();
          }
        }

        WindowManager.mainWindow?.webContents.send("common-redist-progress", {
          log: tail,
          complete: tail?.includes(installationCompleteMessage),
        });
      });
    });

    cp.exec(
      path.join(commonRedistPath, "install.bat"),
      {
        windowsHide: true,
      },
      (error) => {
        if (error) {
          logger.error("Failed to run install.bat", error);
        }
      }
    );
  }

  public static async canInstallCommonRedist() {
    return this.redistributables.every((redist) => {
      const filePath = path.join(commonRedistPath, redist);

      return fs.existsSync(filePath);
    });
  }

  public static async downloadCommonRedist() {
    if (!fs.existsSync(commonRedistPath)) {
      await fs.promises.mkdir(commonRedistPath, { recursive: true });
    }

    for (const redist of this.redistributables) {
      const filePath = path.join(commonRedistPath, redist);

      if (fs.existsSync(filePath) && redist !== "install.bat") {
        continue;
      }

      const response = await axios.get(
        `https://github.com/hydralauncher/hydra-common-redist/raw/refs/heads/main/${redist}`,
        {
          responseType: "arraybuffer",
        }
      );

      await fs.promises.writeFile(filePath, response.data);
    }
  }
}
