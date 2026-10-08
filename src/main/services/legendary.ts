import { app } from "electron";
import path from "node:path";

export class Legendary {
  public static getBinaryPath() {
    if (!["linux", "win32", "darwin"].includes(process.platform)) return null;
    if (process.arch !== "x64" && process.arch !== "arm64") return null;
    const binary = process.platform === "win32" ? "legendary.exe" : "legendary";
    return app.isPackaged
      ? path.join(process.resourcesPath, "legendary", binary)
      : path.join(
          __dirname,
          "..",
          "..",
          "legendary",
          process.platform,
          process.arch,
          binary
        );
  }
}
