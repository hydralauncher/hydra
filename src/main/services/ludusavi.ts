import type { GameShop, LudusaviBackup, LudusaviConfig } from "@types";
import Piscina from "piscina";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import ludusaviWorkerPath from "../workers/ludusavi.worker?modulePath";
import { LUDUSAVI_MANIFEST_URL } from "@main/constants";

export class Ludusavi {
  private static ludusaviPath = path.join(app.getPath("appData"), "ludusavi");
  private static ludusaviConfigPath = path.join(
    this.ludusaviPath,
    "config.yaml"
  );
  private static binaryPath = app.isPackaged
    ? path.join(process.resourcesPath, "ludusavi", "ludusavi")
    : path.join(__dirname, "..", "..", "ludusavi", "ludusavi");

  private static worker = new Piscina({
    filename: ludusaviWorkerPath,
    workerData: {
      binaryPath: this.binaryPath,
    },
    maxThreads: 1,
  });

  static async getConfig() {
    if (!fs.existsSync(this.ludusaviConfigPath)) {
      await this.worker.run(undefined, { name: "generateConfig" });
    }

    const config = YAML.parse(
      fs.readFileSync(this.ludusaviConfigPath, "utf-8")
    ) as LudusaviConfig;

    return config;
  }

  static async backupGame(
    _shop: GameShop,
    objectId: string,
    backupPath: string,
    winePrefix?: string | null
  ): Promise<LudusaviBackup> {
    return this.worker.run(
      { title: objectId, backupPath, winePrefix },
      { name: "backupGame" }
    );
  }

  static async getBackupPreview(
    _shop: GameShop,
    objectId: string,
    winePrefix?: string | null
  ): Promise<LudusaviBackup | null> {
    const config = await this.getConfig();

    const backupData = await this.worker.run(
      { title: objectId, winePrefix, preview: true },
      { name: "backupGame" }
    );

    const customGame = config.customGames.find(
      (game) => game.name === objectId
    );

    return {
      ...backupData,
      customBackupPath: customGame?.files[0] || null,
    };
  }

  static async restoreBackup(backupPath: string) {
    return this.worker.run(backupPath, { name: "restoreBackup" });
  }

  static async addManifestToLudusaviConfig() {
    const config = await this.getConfig();

    config.manifest.enable = false;
    config.manifest.secondary = [{ url: LUDUSAVI_MANIFEST_URL, enable: true }];

    fs.writeFileSync(this.ludusaviConfigPath, YAML.stringify(config));
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
    fs.writeFileSync(this.ludusaviConfigPath, YAML.stringify(config));
  }
}
