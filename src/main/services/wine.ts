import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "./system-path";

export class Wine {
  public static getDefaultPrefixPath(): string | null {
    if (process.platform !== "linux") {
      return null;
    }

    return path.join(SystemPath.getPath("userData"), "wine-prefix");
  }

  public static getEffectivePrefixPath(
    winePrefixPath?: string | null
  ): string | null {
    if (winePrefixPath) {
      return winePrefixPath;
    }

    return this.getDefaultPrefixPath();
  }

  public static validatePrefix(winePrefixPath: string) {
    const requiredFiles = [
      { name: "system.reg", type: "file" },
      { name: "user.reg", type: "file" },
      { name: "userdef.reg", type: "file" },
      { name: "dosdevices", type: "dir" },
      { name: "drive_c", type: "dir" },
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(winePrefixPath, file.name);

      if (file.type === "file" && !fs.existsSync(filePath)) {
        return false;
      }

      if (file.type === "dir") {
        if (!fs.existsSync(filePath) || !fs.lstatSync(filePath).isDirectory()) {
          return false;
        }
      }
    }

    return true;
  }
}
