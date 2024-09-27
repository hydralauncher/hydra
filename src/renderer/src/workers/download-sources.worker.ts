import { db, downloadSourcesTable, repacksTable } from "@renderer/dexie";

import { z } from "zod";
import axios, { AxiosError, AxiosHeaders } from "axios";
import { DownloadSourceStatus } from "@shared";

export const downloadSourceSchema = z.object({
  name: z.string().max(255),
  downloads: z.array(
    z.object({
      title: z.string().max(255),
      uris: z.array(z.string()),
      uploadDate: z.string().max(255),
      fileSize: z.string().max(255),
    })
  ),
});

type Payload =
  | ["IMPORT_DOWNLOAD_SOURCE", string]
  | ["DELETE_DOWNLOAD_SOURCE", number]
  | ["VALIDATE_DOWNLOAD_SOURCE", string]
  | ["SYNC_DOWNLOAD_SOURCES", string];

self.onmessage = async (event: MessageEvent<Payload>) => {
  const [type, data] = event.data;

  if (type === "VALIDATE_DOWNLOAD_SOURCE") {
    const response =
      await axios.get<z.infer<typeof downloadSourceSchema>>(data);

    const { name } = downloadSourceSchema.parse(response.data);

    const channel = new BroadcastChannel(`download_sources:validate:${data}`);

    channel.postMessage({
      name,
      etag: response.headers["etag"],
      downloadCount: response.data.downloads.length,
    });
  }

  if (type === "DELETE_DOWNLOAD_SOURCE") {
    await db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
      await repacksTable.where({ downloadSourceId: data }).delete();
      await downloadSourcesTable.where({ id: data }).delete();
    });

    const channel = new BroadcastChannel(`download_sources:delete:${data}`);

    channel.postMessage(true);
  }

  if (type === "IMPORT_DOWNLOAD_SOURCE") {
    const response =
      await axios.get<z.infer<typeof downloadSourceSchema>>(data);

    await db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
      const now = new Date();

      const id = await downloadSourcesTable.add({
        url: data,
        name: response.data.name,
        etag: response.headers["etag"],
        status: DownloadSourceStatus.UpToDate,
        downloadCount: response.data.downloads.length,
        createdAt: now,
        updatedAt: now,
      });

      const downloadSource = await downloadSourcesTable.get(id);

      const repacks = response.data.downloads.map((download) => ({
        title: download.title,
        uris: download.uris,
        fileSize: download.fileSize,
        repacker: response.data.name,
        uploadDate: download.uploadDate,
        downloadSourceId: downloadSource!.id,
        createdAt: now,
        updatedAt: now,
      }));

      await repacksTable.bulkAdd(repacks);
    });

    const channel = new BroadcastChannel(`download_sources:import:${data}`);
    channel.postMessage(true);
  }

  if (type === "SYNC_DOWNLOAD_SOURCES") {
    const channel = new BroadcastChannel(`download_sources:sync:${data}`);
    let newRepacksCount = 0;

    try {
      const downloadSources = await downloadSourcesTable.toArray();
      const existingRepacks = await repacksTable.toArray();

      for (const downloadSource of downloadSources) {
        const headers = new AxiosHeaders();

        if (downloadSource.etag) {
          headers.set("If-None-Match", downloadSource.etag);
        }

        try {
          const response = await axios.get(downloadSource.url, {
            headers,
          });

          const source = downloadSourceSchema.parse(response.data);

          await db.transaction(
            "rw",
            repacksTable,
            downloadSourcesTable,
            async () => {
              await downloadSourcesTable.update(downloadSource.id, {
                etag: response.headers["etag"],
                downloadCount: source.downloads.length,
                status: DownloadSourceStatus.UpToDate,
              });

              const now = new Date();

              const repacks = source.downloads
                .filter(
                  (download) =>
                    !existingRepacks.some(
                      (repack) => repack.title === download.title
                    )
                )
                .map((download) => ({
                  title: download.title,
                  uris: download.uris,
                  fileSize: download.fileSize,
                  repacker: source.name,
                  uploadDate: download.uploadDate,
                  downloadSourceId: downloadSource.id,
                  createdAt: now,
                  updatedAt: now,
                }));

              newRepacksCount += repacks.length;

              await repacksTable.bulkAdd(repacks);
            }
          );
        } catch (err: unknown) {
          const isNotModified = (err as AxiosError).response?.status === 304;

          await downloadSourcesTable.update(downloadSource.id, {
            status: isNotModified
              ? DownloadSourceStatus.UpToDate
              : DownloadSourceStatus.Errored,
          });
        }
      }

      channel.postMessage(newRepacksCount);
    } catch (err) {
      channel.postMessage(-1);
    }
  }
};
