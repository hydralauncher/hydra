import { db, downloadSourcesTable, repacksTable } from "@renderer/dexie";

self.onmessage = () => {
  db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
    await repacksTable.where({ downloadSourceId: 10 }).delete();
    await downloadSourcesTable.where({ id: 10 }).delete();
  });
};
