import fs from "node:fs";
import path from "node:path";

export class Wine {
  public static validatePrefix(winePrefixPath: string) {
    const requiredFiles = [
      "system.reg",
      "user.reg",
      "userdef.reg",
      "dosdevices",
      "drive_c",
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(winePrefixPath, file);
      if (!fs.existsSync(filePath)) {
        return false;
      }
    }

    return true;
  }
}
