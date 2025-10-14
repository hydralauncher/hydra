import { registerEvent } from "../register-event";
import axios, { AxiosError } from "axios";
import { z } from "zod";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { DownloadSourceStatus } from "@shared";
import { invalidateDownloadSourcesCache, invalidateIdCaches } from "./helpers";

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

const addNewDownloads = async (
  downloadSource: { id: number; name: string },
  downloads: z.infer<typeof downloadSourceSchema>["downloads"],
  steamGames: FormattedSteamGamesByLetter
) => {
  const now = new Date();
  const objectIdsOnSource = new Set<string>();

  let nextRepackId = await getNextId(repacksSublevel);

  const batch = repacksSublevel.batch();

  for (const download of downloads) {
    const formattedTitle = formatRepackName(download.title);
    let gamesInSteam: FormattedSteamGame[] = [];

    // Only try to match if we have a valid formatted title
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
      // This helps with repacks that use abbreviations or alternate naming
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
    }

    // Add matched game IDs to source tracking
    for (const game of gamesInSteam) {
      objectIdsOnSource.add(String(game.id));
    }

    // Create the repack even if no games matched
    // This ensures all repacks from sources are imported
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

    batch.put(`${repack.id}`, repack);
  }

  await batch.write();

  const existingSource = await downloadSourcesSublevel.get(
    `${downloadSource.id}`
  );
  if (existingSource) {
    await downloadSourcesSublevel.put(`${downloadSource.id}`, {
      ...existingSource,
      objectIds: Array.from(objectIdsOnSource),
    });
  }
};

const syncDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<number> => {
  let newRepacksCount = 0;

  try {
    const downloadSources: Array<{
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
    }> = [];
    for await (const [, source] of downloadSourcesSublevel.iterator()) {
      downloadSources.push(source);
    }

    const existingRepacks: Array<{
      id: number;
      title: string;
      uris: string[];
      repacker: string;
      fileSize: string | null;
      objectIds: string[];
      uploadDate: Date | string | null;
      downloadSourceId: number;
      createdAt: Date;
      updatedAt: Date;
    }> = [];
    for await (const [, repack] of repacksSublevel.iterator()) {
      existingRepacks.push(repack);
    }

    // Handle sources with missing fingerprints individually, don't delete all sources
    const sourcesWithFingerprints = downloadSources.filter(
      (source) => source.fingerprint
    );
    const sourcesWithoutFingerprints = downloadSources.filter(
      (source) => !source.fingerprint
    );

    // For sources without fingerprints, just continue with normal sync
    // They will get fingerprints updated later by updateMissingFingerprints
    const allSourcesToSync = [
      ...sourcesWithFingerprints,
      ...sourcesWithoutFingerprints,
    ];

    for (const downloadSource of allSourcesToSync) {
      const headers: Record<string, string> = {};

      if (downloadSource.etag) {
        headers["If-None-Match"] = downloadSource.etag;
      }

      try {
        const response = await axios.get(downloadSource.url, {
          headers,
        });

        const source = downloadSourceSchema.parse(response.data);
        const steamGames = await getSteamGames();

        const repacks = source.downloads.filter(
          (download) =>
            !existingRepacks.some((repack) => repack.title === download.title)
        );

        await downloadSourcesSublevel.put(`${downloadSource.id}`, {
          ...downloadSource,
          etag: response.headers["etag"] || null,
          downloadCount: source.downloads.length,
          status: DownloadSourceStatus.UpToDate,
        });

        await addNewDownloads(downloadSource, repacks, steamGames);

        newRepacksCount += repacks.length;
      } catch (err: unknown) {
        const isNotModified = (err as AxiosError).response?.status === 304;

        await downloadSourcesSublevel.put(`${downloadSource.id}`, {
          ...downloadSource,
          status: isNotModified
            ? DownloadSourceStatus.UpToDate
            : DownloadSourceStatus.Errored,
        });
      }
    }

    // Invalidate caches after all sync operations complete
    invalidateDownloadSourcesCache();
    invalidateIdCaches();

    return newRepacksCount;
  } catch (err) {
    return -1;
  }
};

registerEvent("syncDownloadSources", syncDownloadSources);
