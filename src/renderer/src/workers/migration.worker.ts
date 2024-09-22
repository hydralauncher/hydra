// import { db, downloadSourcesTable, repacksTable } from "@renderer/dexie";
import { DownloadSource, GameRepack } from "@types";

export type Payload = [DownloadSource[], GameRepack[]];

self.onmessage = async (_event: MessageEvent<Payload>) => {
  // const [downloadSources, gameRepacks] = event.data;
  // const downloadSourcesCount = await downloadSourcesTable.count();
  // if (downloadSources.length > downloadSourcesCount) {
  //   await db.transaction(
  //     "rw",
  //     downloadSourcesTable,
  //     repacksTable,
  //     async () => {}
  //   );
  // }
  // if (type === "MIGRATE_DOWNLOAD_SOURCES") {
  //   const dexieDownloadSources = await downloadSourcesTable.count();
  //   if (data.length > dexieDownloadSources) {
  //     await downloadSourcesTable.clear();
  //     await downloadSourcesTable.bulkAdd(data);
  //   }
  //   self.postMessage("MIGRATE_DOWNLOAD_SOURCES_COMPLETE");
  // }
  // if (type === "MIGRATE_REPACKS") {
  //   const dexieRepacks = await repacksTable.count();
  //   if (data.length > dexieRepacks) {
  //     await repacksTable.clear();
  //     await repacksTable.bulkAdd(
  //       data.map((repack) => ({ ...repack, uris: JSON.stringify(repack.uris) }))
  //     );
  //   }
  //   self.postMessage("MIGRATE_REPACKS_COMPLETE");
  // }
};
