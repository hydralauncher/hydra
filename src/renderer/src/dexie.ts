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

db.version(5).stores({
  repacks: `++id, title, uris, fileSize, uploadDate, downloadSourceId, repacker, createdAt, updatedAt`,
  downloadSources: `++id, url, name, etag, downloadCount, status, createdAt, updatedAt`,
  howLongToBeatEntries: `++id, categories, [shop+objectId], createdAt, updatedAt`,
  catalogueCache: `++id, category, games, createdAt, updatedAt, expiresAt`,
});

export const downloadSourcesTable = db.table("downloadSources");
export const repacksTable = db.table("repacks");
export const howLongToBeatEntriesTable = db.table<HowLongToBeatEntry>(
  "howLongToBeatEntries"
);

export const catalogueCacheTable = db.table<CatalogueCache>("catalogueCache");

db.open();
