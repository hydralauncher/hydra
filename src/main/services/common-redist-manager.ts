import { commonRedistPath } from "@main/constants";
import axios from "axios";
import fs from "node:fs";
import cp from "node:child_process";
import path from "node:path";
import { logger } from "./logger";

export class CommonRedistManager {
  private static readonly redistributables = [
    "dotNetFx40_Full_setup.exe",
    "dxwebsetup.exe",
    "oalinst.exe",
    "install.bat",
    "vcredist_2015-2019_x64.exe",
    "vcredist_2015-2019_x86.exe",
    "vcredist_x64.exe",
    "vcredist_x86.exe",
    "xnafx40_redist.msi",
  ];

  public static async installCommonRedist() {
    cp.execFile(path.join(commonRedistPath, "install.bat"), (error) => {
      if (error) {
        logger.error("Failed to run install.bat", error);
      }
    });
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

      if (fs.existsSync(filePath)) {
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
