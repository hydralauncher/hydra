import axios from "axios";
import { z } from "zod";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { DownloadSourceStatus } from "@shared";
import crypto from "node:crypto";
import { logger, ResourceCache } from "@main/services";

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

export type TitleHashMapping = Record<string, number[]>;

let titleHashMappingCache: TitleHashMapping | null = null;

export const getTitleHashMapping = async (): Promise<TitleHashMapping> => {
  if (titleHashMappingCache) {
    return titleHashMappingCache;
  }

  try {
    const cached =
      ResourceCache.getCachedData<TitleHashMapping>("sources-manifest");
    if (cached) {
      titleHashMappingCache = cached;
      return cached;
    }

    const fetched = await ResourceCache.fetchAndCache<TitleHashMapping>(
      "sources-manifest",
      "https://cdn.losbroxas.org/sources-manifest.json",
      10000
    );
    titleHashMappingCache = fetched;
    return fetched;
  } catch (error) {
    logger.error("Failed to fetch title hash mapping:", error);
    return {} as TitleHashMapping;
  }
};

export const hashTitle = (title: string): string => {
  return crypto.createHash("sha256").update(title).digest("hex");
};

export type SteamGamesByLetter = Record<string, { id: string; name: string }[]>;
export type FormattedSteamGame = {
  id: string;
  name: string;
  formattedName: string;
};
export type FormattedSteamGamesByLetter = Record<string, FormattedSteamGame[]>;

export const formatName = (name: string) => {
  return name
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/g, "");
};

export const formatRepackName = (name: string) => {
  return formatName(name.replace("[DL]", ""));
};

interface DownloadSource {
  id: number;
  url: string;
  name: string;
  etag: string | null;
  status: number;
  downloadCount: number;
  objectIds: string[];
  fingerprint?: string;
  createdAt: Date;
  updatedAt: Date;
}

const getDownloadSourcesMap = async (): Promise<
  Map<string, DownloadSource>
> => {
  const map = new Map();
  for await (const [key, source] of downloadSourcesSublevel.iterator()) {
    map.set(key, source);
  }

  return map;
};

export const checkUrlExists = async (url: string): Promise<boolean> => {
  const sources = await getDownloadSourcesMap();
  for (const source of sources.values()) {
    if (source.url === url) {
      return true;
    }
  }
  return false;
};

let steamGamesFormattedCache: FormattedSteamGamesByLetter | null = null;

export const getSteamGames = async (): Promise<FormattedSteamGamesByLetter> => {
  if (steamGamesFormattedCache) {
    return steamGamesFormattedCache;
  }

  let steamGames: SteamGamesByLetter;

  const cached = ResourceCache.getCachedData<SteamGamesByLetter>(
    "steam-games-by-letter"
  );
  if (cached) {
    steamGames = cached;
  } else {
    steamGames = await ResourceCache.fetchAndCache<SteamGamesByLetter>(
      "steam-games-by-letter",
      `${import.meta.env.MAIN_VITE_EXTERNAL_RESOURCES_URL}/steam-games-by-letter.json`
    );
  }

  const formattedData: FormattedSteamGamesByLetter = {};
  for (const [letter, games] of Object.entries(steamGames)) {
    formattedData[letter] = games.map((game) => ({
      ...game,
      formattedName: formatName(game.name),
    }));
  }

  steamGamesFormattedCache = formattedData;
  return formattedData;
};

export type SublevelIterator = AsyncIterable<[string, { id: number }]>;

export interface SublevelWithId {
  iterator: () => SublevelIterator;
}

let maxRepackId: number | null = null;
let maxDownloadSourceId: number | null = null;

export const getNextId = async (sublevel: SublevelWithId): Promise<number> => {
  const isRepackSublevel = sublevel === repacksSublevel;
  const isDownloadSourceSublevel = sublevel === downloadSourcesSublevel;

  if (isRepackSublevel && maxRepackId !== null) {
    return ++maxRepackId;
  }

  if (isDownloadSourceSublevel && maxDownloadSourceId !== null) {
    return ++maxDownloadSourceId;
  }

  let maxId = 0;
  for await (const [, value] of sublevel.iterator()) {
    if (value.id > maxId) {
      maxId = value.id;
    }
  }

  if (isRepackSublevel) {
    maxRepackId = maxId;
  } else if (isDownloadSourceSublevel) {
    maxDownloadSourceId = maxId;
  }

  return maxId + 1;
};

export const invalidateIdCaches = () => {
  maxRepackId = null;
  maxDownloadSourceId = null;
};

export const addNewDownloads = async (
  downloadSource: { id: number; name: string },
  downloads: z.infer<typeof downloadSourceSchema>["downloads"],
  steamGames: FormattedSteamGamesByLetter
) => {
  const now = new Date();
  const objectIdsOnSource = new Set<string>();

  let nextRepackId = await getNextId(repacksSublevel);

  const batch = repacksSublevel.batch();

  // Get title hash mapping and perform matching in worker thread
  const titleHashMapping = await getTitleHashMapping();

  const { GameMatcherWorkerManager } = await import("@main/services");
  const matchResult = await GameMatcherWorkerManager.matchDownloads(
    downloads,
    steamGames,
    titleHashMapping
  );

  // Process matched results and write to database
  for (const matchedDownload of matchResult.matchedDownloads) {
    for (const id of matchedDownload.objectIds) {
      objectIdsOnSource.add(id);
    }

    const repack = {
      id: nextRepackId++,
      objectIds: matchedDownload.objectIds,
      title: matchedDownload.title,
      uris: matchedDownload.uris,
      fileSize: matchedDownload.fileSize,
      repacker: downloadSource.name,
      uploadDate: matchedDownload.uploadDate,
      downloadSourceId: downloadSource.id,
      createdAt: now,
      updatedAt: now,
    };

    batch.put(`${repack.id}`, repack);
  }

  await batch.write();

  logger.info(
    `Matching stats for ${downloadSource.name}: Hash=${matchResult.stats.hashMatchCount}, Fuzzy=${matchResult.stats.fuzzyMatchCount}, None=${matchResult.stats.noMatchCount}`
  );

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

  // Invalidate ID caches after creating new repacks to prevent ID collisions
  invalidateIdCaches();

  return {
    ...downloadSource,
    objectIds,
  };
};

export const updateDownloadSourcePreservingTimestamp = async (
  existingSource: DownloadSource,
  url: string
) => {
  const response = await axios.get<z.infer<typeof downloadSourceSchema>>(url);

  const updatedSource = {
    ...existingSource,
    name: response.data.name,
    etag: response.headers["etag"] || null,
    status: DownloadSourceStatus.UpToDate,
    downloadCount: response.data.downloads.length,
    updatedAt: new Date(),
    // Preserve the original createdAt timestamp
  };

  await downloadSourcesSublevel.put(`${existingSource.id}`, updatedSource);

  return updatedSource;
};
