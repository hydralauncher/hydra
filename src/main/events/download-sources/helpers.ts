import axios from "axios";
import { z } from "zod";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { DownloadSourceStatus } from "@shared";

const downloadSourceSchema = z.object({
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

type SteamGamesByLetter = Record<string, { id: string; name: string }[]>;

const formatName = (name: string) => {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

const formatRepackName = (name: string) => {
  return formatName(name.replace("[DL]", ""));
};

export const checkUrlExists = async (url: string): Promise<boolean> => {
  for await (const [, source] of downloadSourcesSublevel.iterator()) {
    if (source.url === url) {
      return true;
    }
  }
  return false;
};

const getSteamGames = async () => {
  const response = await axios.get<SteamGamesByLetter>(
    `${import.meta.env.MAIN_VITE_EXTERNAL_RESOURCES_URL}/steam-games-by-letter.json`
  );

  return response.data;
};

type SublevelIterator = AsyncIterable<[string, { id: number }]>;

interface SublevelWithId {
  iterator: () => SublevelIterator;
}

const getNextId = async (sublevel: SublevelWithId): Promise<number> => {
  let maxId = 0;
  for await (const [, value] of sublevel.iterator()) {
    if (value.id > maxId) {
      maxId = value.id;
    }
  }
  return maxId + 1;
};

const addNewDownloads = async (
  downloadSource: { id: number; name: string },
  downloads: z.infer<typeof downloadSourceSchema>["downloads"],
  steamGames: SteamGamesByLetter
) => {
  const now = new Date();
  const objectIdsOnSource = new Set<string>();

  let nextRepackId = await getNextId(repacksSublevel);

  for (const download of downloads) {
    const formattedTitle = formatRepackName(download.title);
    const [firstLetter] = formattedTitle;
    const games = steamGames[firstLetter] || [];

    const gamesInSteam = games.filter((game) =>
      formattedTitle.startsWith(formatName(game.name))
    );

    if (gamesInSteam.length === 0) continue;

    for (const game of gamesInSteam) {
      objectIdsOnSource.add(String(game.id));
    }

    const repack = {
      id: nextRepackId++,
      objectIds: gamesInSteam.map((game) => String(game.id)),
      title: download.title,
      uris: download.uris,
      fileSize: download.fileSize,
      repacker: downloadSource.name,
      uploadDate: download.uploadDate,
      downloadSourceId: downloadSource.id,
      createdAt: now,
      updatedAt: now,
    };

    await repacksSublevel.put(`${repack.id}`, repack);
  }

  const existingSource = await downloadSourcesSublevel.get(
    `${downloadSource.id}`
  );
  if (existingSource) {
    await downloadSourcesSublevel.put(`${downloadSource.id}`, {
      ...existingSource,
      objectIds: Array.from(objectIdsOnSource),
    });
  }

  return Array.from(objectIdsOnSource);
};

export const importDownloadSourceToLocal = async (
  url: string,
  throwOnDuplicate = false
) => {
  const urlExists = await checkUrlExists(url);
  if (urlExists) {
    if (throwOnDuplicate) {
      throw new Error("Download source with this URL already exists");
    }
    return null;
  }

  const response = await axios.get<z.infer<typeof downloadSourceSchema>>(url);

  const steamGames = await getSteamGames();

  const now = new Date();

  const urlExistsBeforeInsert = await checkUrlExists(url);
  if (urlExistsBeforeInsert) {
    if (throwOnDuplicate) {
      throw new Error("Download source with this URL already exists");
    }
    return null;
  }

  const nextId = await getNextId(downloadSourcesSublevel);

  const downloadSource = {
    id: nextId,
    url,
    name: response.data.name,
    etag: response.headers["etag"] || null,
    status: DownloadSourceStatus.UpToDate,
    downloadCount: response.data.downloads.length,
    objectIds: [],
    createdAt: now,
    updatedAt: now,
  };

  await downloadSourcesSublevel.put(`${downloadSource.id}`, downloadSource);

  const objectIds = await addNewDownloads(
    downloadSource,
    response.data.downloads,
    steamGames
  );

  return {
    ...downloadSource,
    objectIds,
  };
};
