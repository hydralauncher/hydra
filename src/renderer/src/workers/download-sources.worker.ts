import { db, downloadSourcesTable, repacksTable } from "@renderer/dexie";

import { z } from "zod";
import axios, { AxiosError, AxiosHeaders } from "axios";
import { DownloadSourceStatus, formatName, pipe } from "@shared";
import { GameRepack } from "@types";

const formatRepackName = pipe((name) => name.replace("[DL]", ""), formatName);

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
  | ["SYNC_DOWNLOAD_SOURCES", string]
  | ["DELETE_ALL_DOWNLOAD_SOURCES", string];

export type SteamGamesByLetter = Record<string, { id: string; name: string }[]>;

const addNewDownloads = async (
  downloadSource: { id: number; name: string },
  downloads: z.infer<typeof downloadSourceSchema>["downloads"],
  steamGames: SteamGamesByLetter
) => {
  const now = new Date();

  const results = [] as (Omit<GameRepack, "id"> & {
    downloadSourceId: number;
  })[];

  const objectIdsOnSource = new Set<string>();

  for (const download of downloads) {
    const formattedTitle = formatRepackName(download.title);
    const [firstLetter] = formattedTitle;
    const games = steamGames[firstLetter] || [];

    const gamesInSteam = games.filter((game) =>
      formattedTitle.startsWith(game.name)
    );

    if (gamesInSteam.length === 0) continue;

    for (const game of gamesInSteam) {
      objectIdsOnSource.add(String(game.id));
    }

    results.push({
      objectIds: gamesInSteam.map((game) => String(game.id)),
      title: download.title,
      uris: download.uris,
      fileSize: download.fileSize,
      repacker: downloadSource.name,
      uploadDate: download.uploadDate,
      downloadSourceId: downloadSource.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  await repacksTable.bulkAdd(results);

  await downloadSourcesTable.update(downloadSource.id, {
    objectIds: Array.from(objectIdsOnSource),
  });
};

const getSteamGames = async () => {
  const response = await axios.get<SteamGamesByLetter>(
    `${import.meta.env.RENDERER_VITE_EXTERNAL_RESOURCES_URL}/steam-games-by-letter.json`
  );

  return response.data;
};

const importDownloadSource = async (url: string) => {
  const response = await axios.get<z.infer<typeof downloadSourceSchema>>(url);

  const steamGames = await getSteamGames();

  await db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
    const now = new Date();

    const id = await downloadSourcesTable.add({
      url,
      name: response.data.name,
      etag: response.headers["etag"],
      status: DownloadSourceStatus.UpToDate,
      downloadCount: response.data.downloads.length,
      createdAt: now,
      updatedAt: now,
    });

    const downloadSource = await downloadSourcesTable.get(id);

    await addNewDownloads(downloadSource, response.data.downloads, steamGames);
  });
};

const deleteDownloadSource = async (id: number) => {
  await db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
    await repacksTable.where({ downloadSourceId: id }).delete();
    await downloadSourcesTable.where({ id }).delete();
  });
};

const deleteAllDowloadSources = async () => {
  await db.transaction("rw", repacksTable, downloadSourcesTable, async () => {
    await repacksTable.clear();
    await downloadSourcesTable.clear();
  });
};

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

  if (type === "DELETE_ALL_DOWNLOAD_SOURCES") {
    await deleteAllDowloadSources();

    const channel = new BroadcastChannel(`download_sources:delete_all:${data}`);

    channel.postMessage(true);
  }

  if (type === "DELETE_DOWNLOAD_SOURCE") {
    await deleteDownloadSource(data);

    const channel = new BroadcastChannel(`download_sources:delete:${data}`);

    channel.postMessage(true);
  }

  if (type === "IMPORT_DOWNLOAD_SOURCE") {
    await importDownloadSource(data);

    const channel = new BroadcastChannel(`download_sources:import:${data}`);
    channel.postMessage(true);
  }

  if (type === "SYNC_DOWNLOAD_SOURCES") {
    const channel = new BroadcastChannel(`download_sources:sync:${data}`);
    let newRepacksCount = 0;

    try {
      const downloadSources = await downloadSourcesTable.toArray();
      const existingRepacks = await repacksTable.toArray();

      if (downloadSources.some((source) => !source.fingerprint)) {
        await Promise.all(
          downloadSources.map(async (source) => {
            await deleteDownloadSource(source.id);
            await importDownloadSource(source.url);
          })
        );
      } else {
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

            const steamGames = await getSteamGames();

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

                const repacks = source.downloads.filter(
                  (download) =>
                    !existingRepacks.some(
                      (repack) => repack.title === download.title
                    )
                );

                await addNewDownloads(downloadSource, repacks, steamGames);

                newRepacksCount += repacks.length;
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
      }

      channel.postMessage(newRepacksCount);
    } catch (err) {
      channel.postMessage(-1);
    }
  }
};
