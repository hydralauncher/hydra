import fs from "node:fs";
import path from "node:path";
import { SystemPath } from "./system-path";

export class Wine {
  public static getDefaultPrefixPath(): string | null {
    if (process.platform !== "linux") {
      return null;
    }

    return path.join(SystemPath.getPath("userData"), "wine-prefixes");
  }

  public static getLegacyDefaultPrefixPath(): string | null {
    if (process.platform !== "linux") {
      return null;
    }

    return path.join(SystemPath.getPath("userData"), "wine-prefix");
  }

  public static getDefaultPrefixPathForGame(objectId: string): string | null {
    const defaultPrefixPath = this.getDefaultPrefixPath();

    if (!defaultPrefixPath) {
      return null;
    }

    return path.join(defaultPrefixPath, objectId);
  }

  public static getEffectivePrefixPath(
    winePrefixPath?: string | null,
    objectId?: string | null
  ): string | null {
    if (winePrefixPath) {
      return winePrefixPath;
    }

    if (!objectId) {
      const legacyPrefixPath = this.getLegacyDefaultPrefixPath();

      if (legacyPrefixPath && fs.existsSync(legacyPrefixPath)) {
        return legacyPrefixPath;
      }

      return null;
    }

    return this.getDefaultPrefixPathForGame(objectId);
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
