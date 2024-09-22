import { db, downloadSourcesTable, repacksTable } from "@renderer/dexie";
import { DownloadSourceStatus } from "@shared";
import type { DownloadSourceValidationResult } from "@types";

type Payload =
  | ["IMPORT_DOWNLOAD_SOURCE", DownloadSourceValidationResult & { url: string }]
  | ["DELETE_DOWNLOAD_SOURCE", number];

db.open();

self.onmessage = async (event: MessageEvent<Payload>) => {
  const [type, data] = event.data;

  if (type === "DELETE_DOWNLOAD_SOURCE") {
    await db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
      await repacksTable.where({ downloadSourceId: data }).delete();
      await downloadSourcesTable.where({ id: data }).delete();
    });

    const channel = new BroadcastChannel(`download_sources:delete:${data}`);

    channel.postMessage(true);
  }

  if (type === "IMPORT_DOWNLOAD_SOURCE") {
    const result = data;

    await db.transaction("rw", downloadSourcesTable, repacksTable, async () => {
      const now = new Date();

      const id = await downloadSourcesTable.add({
        url: result.url,
        name: result.name,
        etag: result.etag,
        status: DownloadSourceStatus.UpToDate,
        downloadCount: result.downloads.length,
        createdAt: now,
        updatedAt: now,
      });

      const downloadSource = await downloadSourcesTable.get(id);

      const repacks = result.downloads.map((download) => ({
        title: download.title,
        uris: download.uris,
        fileSize: download.fileSize,
        repacker: result.name,
        uploadDate: download.uploadDate,
        downloadSourceId: downloadSource!.id,
        createdAt: now,
        updatedAt: now,
      }));

      await repacksTable.bulkAdd(repacks);
    });

    const channel = new BroadcastChannel(
      `download_sources:import:${result.url}`
    );

    channel.postMessage(true);
  }
};
