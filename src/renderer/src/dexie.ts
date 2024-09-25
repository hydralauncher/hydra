import { GameShop } from "@types";
import { Dexie } from "dexie";

export interface GameBackup {
  id?: number;
  shop: GameShop;
  objectId: string;
  createdAt: Date;
}

export const db = new Dexie("Hydra");

db.version(3).stores({
  repacks: `++id, title, uris, fileSize, uploadDate, downloadSourceId, repacker, createdAt, updatedAt`,
  downloadSources: `++id, url, name, etag, downloadCount, status, createdAt, updatedAt`,
  gameBackups: `++id, [shop+objectId], createdAt`,
});

export const downloadSourcesTable = db.table("downloadSources");
export const repacksTable = db.table("repacks");
export const gameBackupsTable = db.table<GameBackup>("gameBackups");

db.open();
