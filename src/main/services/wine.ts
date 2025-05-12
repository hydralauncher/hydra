import fs from "node:fs";
import path from "node:path";

export class Wine {
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
