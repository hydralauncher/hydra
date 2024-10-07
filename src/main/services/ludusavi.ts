import { GameShop, LudusaviBackup } from "@types";
import Piscina from "piscina";

import { app } from "electron";
import path from "node:path";

import ludusaviWorkerPath from "../workers/ludusavi.worker?modulePath";

const binaryPath = app.isPackaged
  ? path.join(process.resourcesPath, "ludusavi", "ludusavi")
  : path.join(__dirname, "..", "..", "ludusavi", "ludusavi");

export class Ludusavi {
  private static worker = new Piscina({
    filename: ludusaviWorkerPath,
    workerData: {
      binaryPath,
    },
  });

  static async findGames(shop: GameShop, objectId: string): Promise<string[]> {
    const games = await this.worker.run(
      { objectId, shop },
      { name: "findGames" }
    );

    return games;
  }

  static async backupGame(
    shop: GameShop,
    objectId: string,
    backupPath: string
  ): Promise<LudusaviBackup> {
    const games = await this.findGames(shop, objectId);
    if (!games.length) throw new Error("Game not found");

    return this.worker.run(
      { title: games[0], backupPath },
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

    const backupData = await this.worker.run(
      { title: games[0], backupPath, preview: true },
      { name: "backupGame" }
    );

    return backupData;
  }

  static async restoreBackup(backupPath: string) {
    return this.worker.run(backupPath, { name: "restoreBackup" });
  }
}
