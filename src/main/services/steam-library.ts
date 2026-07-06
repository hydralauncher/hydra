import path from "node:path";
import fs from "node:fs";

import { gamesSublevel } from "@main/level";
import { getSteamLocation, getSteamUsersIds } from "./steam";
import { parseVdf, getVdfValue, type VdfObject } from "./steam-vdf";
import { logger } from "./logger";

export interface InstalledSteamGame {
  objectId: string;
  title: string;
}

const getSteamLibraryFolders = (steamLocation: string): string[] => {
  const libraryFoldersPath = path.join(
    steamLocation,
    "steamapps",
    "libraryfolders.vdf"
  );

  const folders = new Set<string>([steamLocation]);

  try {
    const parsed = parseVdf(fs.readFileSync(libraryFoldersPath, "utf-8"));
    const libraryFolders = getVdfValue(parsed, "libraryfolders");

    if (libraryFolders && typeof libraryFolders !== "string") {
      for (const entry of Object.values(libraryFolders)) {
        if (typeof entry === "string") {
          // Old format: "1" "D:\\Games\\SteamLibrary"
          folders.add(entry);
        } else {
          const folderPath = getVdfValue(entry, "path");
          if (typeof folderPath === "string") folders.add(folderPath);
        }
      }
    }
  } catch (error) {
    logger.warn("[SteamLibrary] Failed to read libraryfolders.vdf", error);
  }

  return [...folders];
};

// Steam Runtime tools show up as installed apps; hide them.
const knownToolNames =
  /steamworks common redistributables|^proton |^proton$|steam linux runtime/i;

/**
 * Lists games installed through the local Steam client by reading the
 * appmanifest_*.acf files in every Steam library folder.
 */
export const getInstalledSteamGames = async (): Promise<
  InstalledSteamGame[]
> => {
  const steamLocation = await getSteamLocation().catch(() => null);

  if (!steamLocation || !fs.existsSync(steamLocation)) {
    return [];
  }

  const games = new Map<string, InstalledSteamGame>();

  for (const libraryFolder of getSteamLibraryFolders(steamLocation)) {
    const steamAppsPath = path.join(libraryFolder, "steamapps");

    let entries: string[];
    try {
      entries = await fs.promises.readdir(steamAppsPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue;

      try {
        const manifest = parseVdf(
          await fs.promises.readFile(path.join(steamAppsPath, entry), "utf-8")
        );

        const appId = getVdfValue(manifest, "AppState", "appid");
        const name = getVdfValue(manifest, "AppState", "name");

        if (typeof appId === "string" && typeof name === "string" && name) {
          games.set(appId, { objectId: appId, title: name });
        }
      } catch (error) {
        logger.warn(`[SteamLibrary] Failed to parse ${entry}`, error);
      }
    }
  }

  return [...games.values()].filter((game) => !knownToolNames.test(game.title));
};

/**
 * Reads per-app playtime (in minutes) tracked by the Steam client from
 * userdata/<accountId>/config/localconfig.vdf. When multiple local accounts
 * exist, the highest value per app wins.
 */
export const getSteamPlaytimeMinutes = async (): Promise<
  Map<string, number>
> => {
  const playtimeByAppId = new Map<string, number>();

  const steamLocation = await getSteamLocation().catch(() => null);
  if (!steamLocation) return playtimeByAppId;

  const userIds = await getSteamUsersIds().catch(() => []);

  for (const userId of userIds) {
    const localConfigPath = path.join(
      steamLocation,
      "userdata",
      String(userId),
      "config",
      "localconfig.vdf"
    );

    let parsed: VdfObject;
    try {
      parsed = parseVdf(await fs.promises.readFile(localConfigPath, "utf-8"));
    } catch {
      continue;
    }

    const apps = getVdfValue(
      parsed,
      "UserLocalConfigStore",
      "Software",
      "Valve",
      "Steam",
      "apps"
    );

    if (!apps || typeof apps === "string") continue;

    for (const [appId, appEntry] of Object.entries(apps)) {
      const playtime = getVdfValue(appEntry, "Playtime");
      if (typeof playtime !== "string") continue;

      const minutes = Number.parseInt(playtime, 10);
      if (!Number.isFinite(minutes) || minutes <= 0) continue;

      const previous = playtimeByAppId.get(appId) ?? 0;
      if (minutes > previous) playtimeByAppId.set(appId, minutes);
    }
  }

  return playtimeByAppId;
};

/**
 * Updates the Steam playtime stat of every Steam-managed library game.
 * Returns the number of games that received a playtime value.
 */
export const syncSteamPlaytimeForLibrary = async (): Promise<number> => {
  const playtimeByAppId = await getSteamPlaytimeMinutes();
  if (playtimeByAppId.size === 0) return 0;

  const games = await gamesSublevel.iterator().all();
  let updatedCount = 0;

  for (const [key, game] of games) {
    if (game.shop !== "steam" || game.isDeleted) continue;

    const minutes = playtimeByAppId.get(game.objectId);
    if (minutes === undefined) continue;

    const milliseconds = minutes * 60 * 1000;
    if (game.steamPlayTimeInMilliseconds === milliseconds) continue;

    await gamesSublevel.put(key, {
      ...game,
      steamPlayTimeInMilliseconds: milliseconds,
      steamPlaytimeLastSyncedAt: new Date(),
    });

    updatedCount += 1;
  }

  return updatedCount;
};
