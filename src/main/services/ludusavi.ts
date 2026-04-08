import type { GameShop, LudusaviBackup, LudusaviConfig } from "@types";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import cp from "node:child_process";
import { SystemPath } from "./system-path";

export class Ludusavi {
  private static ludusaviResourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, "ludusavi")
    : path.join(__dirname, "..", "..", "ludusavi");

  private static configPath = path.join(
    SystemPath.getPath("userData"),
    "ludusavi"
  );
  private static binaryName =
    process.platform === "win32" ? "ludusavi.exe" : "ludusavi";

  private static binaryPath = path.join(this.configPath, this.binaryName);

  public static async getConfig() {
    const config = YAML.parse(
      fs.readFileSync(path.join(this.configPath, "config.yaml"), "utf-8")
    ) as LudusaviConfig;

    return config;
  }

  public static async copyConfigFileToUserData() {
    if (!fs.existsSync(this.configPath)) {
      fs.mkdirSync(this.configPath, { recursive: true });

      fs.cpSync(
        path.join(this.ludusaviResourcesPath, "config.yaml"),
        path.join(this.configPath, "config.yaml")
      );
    }
  }

  public static async copyBinaryToUserData() {
    if (!fs.existsSync(this.binaryPath)) {
      fs.cpSync(
        path.join(this.ludusaviResourcesPath, this.binaryName),
        this.binaryPath
      );
    }
  }

  private static async withSavesOnlyFilter<T>(
    objectId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const config = await this.getConfig();

    if (config.customGames.some((g) => g.name === objectId)) {
      return fn();
    }

    const response = await fetch("https://cdn.losbroxas.org/manifest.yaml");
    const text = await response.text();
    const manifest = YAML.parse(text) as Record<
      string,
      { files?: Record<string, { tags?: string[] }> }
    >;

    const gameEntry = manifest[objectId];
    const savePaths = gameEntry?.files
      ? Object.entries(gameEntry.files)
          .filter(([, entry]) => entry?.tags?.includes("save"))
          .map(([p]) => p)
      : [];

    if (savePaths.length === 0) {
      return fn();
    }

    config.customGames.push({ name: objectId, files: savePaths, registry: [] });
    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );

    try {
      return await fn();
    } finally {
      const currentConfig = await this.getConfig();
      currentConfig.customGames = currentConfig.customGames.filter(
        (g) => g.name !== objectId
      );
      fs.writeFileSync(
        path.join(this.configPath, "config.yaml"),
        YAML.stringify(currentConfig)
      );
    }
  }

  public static async backupGame(
    _shop: GameShop,
    objectId: string,
    backupPath?: string | null,
    winePrefix?: string | null,
    preview?: boolean,
    savesOnly?: boolean
  ): Promise<LudusaviBackup> {
    if (savesOnly) {
      return this.withSavesOnlyFilter(objectId, () =>
        this.backupGame(_shop, objectId, backupPath, winePrefix, preview)
      );
    }

    return new Promise((resolve, reject) => {
      const args = [
        "--config",
        this.configPath,
        "backup",
        objectId,
        "--api",
        "--force",
      ];

      if (preview) args.push("--preview");
      if (backupPath) args.push("--path", backupPath);
      if (winePrefix) args.push("--wine-prefix", winePrefix);

      cp.execFile(
        this.binaryPath,
        args,
        (err: cp.ExecFileException | null, stdout: string) => {
          if (err) {
            return reject(err);
          }

          return resolve(JSON.parse(stdout) as LudusaviBackup);
        }
      );
    });
  }

  public static async getBackupPreview(
    _shop: GameShop,
    objectId: string,
    winePrefix?: string | null,
    savesOnly?: boolean
  ): Promise<LudusaviBackup | null> {
    const config = await this.getConfig();

    const backupData = await this.backupGame(
      _shop,
      objectId,
      null,
      winePrefix,
      true,
      savesOnly
    );

    const customGame = config.customGames.find(
      (game) => game.name === objectId
    );

    return {
      ...backupData,
      customBackupPath: customGame?.files[0] || null,
    };
  }

  static async addCustomGame(title: string, savePath: string | null) {
    const config = await this.getConfig();
    const filteredGames = config.customGames.filter(
      (game) => game.name !== title
    );

    if (savePath) {
      filteredGames.push({
        name: title,
        files: [savePath],
        registry: [],
      });
    }

    config.customGames = filteredGames;

    fs.writeFileSync(
      path.join(this.configPath, "config.yaml"),
      YAML.stringify(config)
    );
  }
}
