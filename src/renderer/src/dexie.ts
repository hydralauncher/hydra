import { Dexie } from "dexie";

export const db = new Dexie("Hydra");

db.version(1).stores({
  repacks: `++id, title, uri, fileSize, uploadDate, downloadSourceId, repacker, createdAt, updatedAt`,
  downloadSources: `++id, url, name, etag, downloadCount, status, createdAt, updatedAt`,
});

export const downloadSourcesTable = db.table("downloadSources");
export const repacksTable = db.table("repacks");

db.open();
