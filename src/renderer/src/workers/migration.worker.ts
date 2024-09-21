import { downloadSourcesTable, repacksTable } from "@renderer/dexie";
import { DownloadSource, GameRepack } from "@types";

export type Payload =
  | ["MIGRATE_REPACKS", GameRepack[]]
  | ["MIGRATE_DOWNLOAD_SOURCES", DownloadSource[]];

self.onmessage = async (event: MessageEvent<Payload>) => {
  const [type, data] = event.data;

  if (type === "MIGRATE_DOWNLOAD_SOURCES") {
    const dexieDownloadSources = await downloadSourcesTable.count();

    if (data.length !== dexieDownloadSources) {
      await downloadSourcesTable.clear();
      await downloadSourcesTable.bulkAdd(data);
    }

    self.postMessage("MIGRATE_DOWNLOAD_SOURCES_COMPLETE");
  }

  if (type === "MIGRATE_REPACKS") {
    const dexieRepacks = await repacksTable.count();

    if (data.length !== dexieRepacks) {
      await repacksTable.clear();
      await repacksTable.bulkAdd(data);
    }

    self.postMessage("MIGRATE_REPACKS_COMPLETE");
  }
};
