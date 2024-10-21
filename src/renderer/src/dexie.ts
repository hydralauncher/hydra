import type { GameShop, HowLongToBeatCategory } from "@types";
import { Dexie } from "dexie";

export interface HowLongToBeatEntry {
  id?: number;
  objectId: string;
  categories: HowLongToBeatCategory[];
  shop: GameShop;
  createdAt: Date;
  updatedAt: Date;
}

export const db = new Dexie("Hydra");

db.version(4).stores({
  repacks: `++id, title, uris, fileSize, uploadDate, downloadSourceId, repacker, createdAt, updatedAt`,
  downloadSources: `++id, url, name, etag, downloadCount, status, createdAt, updatedAt`,
  howLongToBeatEntries: `++id, categories, [shop+objectId], createdAt, updatedAt`,
});

export const downloadSourcesTable = db.table("downloadSources");
export const repacksTable = db.table("repacks");
export const howLongToBeatEntriesTable = db.table<HowLongToBeatEntry>(
  "howLongToBeatEntries"
);

db.open();
