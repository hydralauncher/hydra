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

export interface CatalogueCache {
  id?: number;
  category: string;
  games: { objectId: string; shop: GameShop }[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export const db = new Dexie("Hydra");

db.version(9).stores({
  repacks: `++id, title, uris, fileSize, uploadDate, downloadSourceId, repacker, objectIds, createdAt, updatedAt`,
  downloadSources: `++id, &url, name, etag, objectIds, downloadCount, status, fingerprint, createdAt, updatedAt`,
  howLongToBeatEntries: `++id, categories, [shop+objectId], createdAt, updatedAt`,
});

export const downloadSourcesTable = db.table("downloadSources");
export const repacksTable = db.table("repacks");
export const howLongToBeatEntriesTable = db.table<HowLongToBeatEntry>(
  "howLongToBeatEntries"
);

db.open();
