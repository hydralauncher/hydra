import axios from "axios";
import { z } from "zod";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { DownloadSourceStatus } from "@shared";
import crypto from "crypto";

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

// Pre-computed title-to-Steam-ID mapping
type TitleHashMapping = Record<string, number[]>;
let titleHashMappingCache: TitleHashMapping | null = null;
let titleHashMappingCacheTime = 0;
const TITLE_HASH_MAPPING_TTL = 86400000; // 24 hours

const getTitleHashMapping = async (): Promise<TitleHashMapping> => {
  const now = Date.now();
  if (
    titleHashMappingCache &&
    now - titleHashMappingCacheTime < TITLE_HASH_MAPPING_TTL
  ) {
    return titleHashMappingCache;
  }

  try {
    const response = await axios.get<TitleHashMapping>(
      "https://cdn.losbroxas.org/results_a4c50f70c2.json",
      {
        timeout: 10000,
      }
    );

    titleHashMappingCache = response.data;
    titleHashMappingCacheTime = now;
    console.log(
      `✅ Loaded title hash mapping with ${Object.keys(response.data).length} entries`
    );
    return response.data;
  } catch (error) {
    console.error("Failed to fetch title hash mapping:", error);
    // Return empty mapping on error - will fall back to fuzzy matching
    return {};
  }
};

const hashTitle = (title: string): string => {
  return crypto.createHash("sha256").update(title).digest("hex");
};

type SteamGamesByLetter = Record<string, { id: string; name: string }[]>;
type FormattedSteamGame = { id: string; name: string; formattedName: string };
type FormattedSteamGamesByLetter = Record<string, FormattedSteamGame[]>;

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

let downloadSourcesCache: Map<string, DownloadSource> | null = null;
let downloadSourcesCacheTime = 0;
const CACHE_TTL = 5000;

const getDownloadSourcesMap = async (): Promise<
  Map<string, DownloadSource>
> => {
  const now = Date.now();
  if (downloadSourcesCache && now - downloadSourcesCacheTime < CACHE_TTL) {
    return downloadSourcesCache;
  }

  const map = new Map();
  for await (const [key, source] of downloadSourcesSublevel.iterator()) {
    map.set(key, source);
  }

  downloadSourcesCache = map;
  downloadSourcesCacheTime = now;
  return map;
};

export const invalidateDownloadSourcesCache = () => {
  downloadSourcesCache = null;
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

let steamGamesCache: FormattedSteamGamesByLetter | null = null;
let steamGamesCacheTime = 0;
const STEAM_GAMES_CACHE_TTL = 300000;

const getSteamGames = async (): Promise<FormattedSteamGamesByLetter> => {
  const now = Date.now();
  if (steamGamesCache && now - steamGamesCacheTime < STEAM_GAMES_CACHE_TTL) {
    return steamGamesCache;
  }

  const response = await axios.get<SteamGamesByLetter>(
    `${import.meta.env.MAIN_VITE_EXTERNAL_RESOURCES_URL}/steam-games-by-letter.json`
  );

  const formattedData: FormattedSteamGamesByLetter = {};
  for (const [letter, games] of Object.entries(response.data)) {
    formattedData[letter] = games.map((game) => ({
      ...game,
      formattedName: formatName(game.name),
    }));
  }

  steamGamesCache = formattedData;
  steamGamesCacheTime = now;
  return formattedData;
};

type SublevelIterator = AsyncIterable<[string, { id: number }]>;

interface SublevelWithId {
  iterator: () => SublevelIterator;
}

let maxRepackId: number | null = null;
let maxDownloadSourceId: number | null = null;

const getNextId = async (sublevel: SublevelWithId): Promise<number> => {
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

const addNewDownloads = async (
  downloadSource: { id: number; name: string },
  downloads: z.infer<typeof downloadSourceSchema>["downloads"],
  steamGames: FormattedSteamGamesByLetter
) => {
  const now = new Date();
  const objectIdsOnSource = new Set<string>();

  let nextRepackId = await getNextId(repacksSublevel);

  const batch = repacksSublevel.batch();

  // Fetch the pre-computed hash mapping
  const titleHashMapping = await getTitleHashMapping();
  let hashMatchCount = 0;
  let fuzzyMatchCount = 0;
  let noMatchCount = 0;

  for (const download of downloads) {
    let objectIds: string[] = [];
    let usedHashMatch = false;

    // FIRST: Try hash-based lookup (fast and accurate)
    const titleHash = hashTitle(download.title);
    const steamIdsFromHash = titleHashMapping[titleHash];

    if (steamIdsFromHash && steamIdsFromHash.length > 0) {
      // Found in hash mapping - trust it completely
      hashMatchCount++;
      usedHashMatch = true;

      // Use the Steam IDs directly as strings (trust the hash mapping)
      objectIds = steamIdsFromHash.map(String);
    }

    // FALLBACK: Use fuzzy matching ONLY if hash lookup found nothing
    if (!usedHashMatch) {
      let gamesInSteam: FormattedSteamGame[] = [];
      const formattedTitle = formatRepackName(download.title);

      if (formattedTitle && formattedTitle.length > 0) {
        const [firstLetter] = formattedTitle;
        const games = steamGames[firstLetter] || [];

        // Try exact prefix match first
        gamesInSteam = games.filter((game) =>
          formattedTitle.startsWith(game.formattedName)
        );

        // If no exact prefix match, try contains match (more lenient)
        if (gamesInSteam.length === 0) {
          gamesInSteam = games.filter(
            (game) =>
              formattedTitle.includes(game.formattedName) ||
              game.formattedName.includes(formattedTitle)
          );
        }

        // If still no match, try checking all letters (not just first letter)
        if (gamesInSteam.length === 0) {
          for (const letter of Object.keys(steamGames)) {
            const letterGames = steamGames[letter] || [];
            const matches = letterGames.filter(
              (game) =>
                formattedTitle.includes(game.formattedName) ||
                game.formattedName.includes(formattedTitle)
            );
            if (matches.length > 0) {
              gamesInSteam = matches;
              break;
            }
          }
        }

        if (gamesInSteam.length > 0) {
          fuzzyMatchCount++;
          objectIds = gamesInSteam.map((game) => String(game.id));
        } else {
          noMatchCount++;
        }
      } else {
        noMatchCount++;
      }
    }

    // Add matched game IDs to source tracking
    for (const id of objectIds) {
      objectIdsOnSource.add(id);
    }

    // Create the repack even if no games matched
    // This ensures all repacks from sources are imported
    const repack = {
      id: nextRepackId++,
      objectIds: objectIds,
      title: download.title,
      uris: download.uris,
      fileSize: download.fileSize,
      repacker: downloadSource.name,
      uploadDate: download.uploadDate,
      downloadSourceId: downloadSource.id,
      createdAt: now,
      updatedAt: now,
    };

    batch.put(`${repack.id}`, repack);
  }

  await batch.write();

  // Log matching statistics
  console.log(
    `📊 Matching stats for ${downloadSource.name}: Hash=${hashMatchCount}, Fuzzy=${fuzzyMatchCount}, None=${noMatchCount}`
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

  invalidateDownloadSourcesCache();

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

  invalidateDownloadSourcesCache();

  return updatedSource;
};
