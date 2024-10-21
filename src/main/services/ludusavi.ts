import type { GameShop, LudusaviBackup, LudusaviConfig } from "@types";
import Piscina from "piscina";

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import ludusaviWorkerPath from "../workers/ludusavi.worker?modulePath";

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
  });

  static async findGames(shop: GameShop, objectId: string): Promise<string[]> {
    const games = await this.worker.run(
      { objectId, shop },
      { name: "findGames" }
    );

    return games;
  }

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
    shop: GameShop,
    objectId: string,
    backupPath: string,
    winePrefix?: string | null
  ): Promise<LudusaviBackup> {
    const games = await this.findGames(shop, objectId);
    if (!games.length) throw new Error("Game not found");

    return this.worker.run(
      { title: games[0], backupPath, winePrefix },
      { name: "backupGame" }
    );
  }

  static async getBackupPreview(
    shop: GameShop,
    objectId: string,
    backupPath: string
  ): Promise<LudusaviBackup | null> {
    const games = await this.findGames(shop, objectId);

    if (!games.length) return null;
    const [game] = games;

    const backupData = await this.worker.run(
      { title: game, backupPath, preview: true },
      { name: "backupGame" }
    );

    return backupData;
  }

  static async restoreBackup(backupPath: string) {
    return this.worker.run(backupPath, { name: "restoreBackup" });
  }

  static async addManifestToLudusaviConfig() {
    const config = await this.getConfig();

    config.manifest.enable = false;
    config.manifest.secondary = [
      { url: "https://cdn.losbroxas.org/manifest.yaml", enable: true },
    ];

    fs.writeFileSync(this.ludusaviConfigPath, YAML.stringify(config));
  }

  static async addCustomGame(title: string, savePath: string) {
    const config = await this.getConfig();
    const filteredGames = config.customGames.filter(
      (game) => game.name !== title
    );

    filteredGames.push({
      name: title,
      files: [savePath],
      registry: [],
    });

    config.customGames = filteredGames;
    fs.writeFileSync(this.ludusaviConfigPath, YAML.stringify(config));
  }
}
