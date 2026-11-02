import path from "node:path";
import { getSteamLibraryFolders, getSteamLocation } from "../steam";
import { steamSyncLogger } from "../logger";
import { readSteamAppInfo, type SteamAppInfo } from "./steam-app-info-core";
import {
  listInstalledSteamApps,
  type InstalledSteamApp,
} from "./steam-installation-core";

export const getSteamAppInfoPath = async (): Promise<string | null> => {
  const steamLocation = await getSteamLocation().catch(() => null);

  return steamLocation
    ? path.join(steamLocation, "appcache", "appinfo.vdf")
    : null;
};

export const loadSteamAppInfo = async (
  appIds: Iterable<string>
): Promise<Map<string, SteamAppInfo>> => {
  const appInfoPath = await getSteamAppInfoPath();
  if (!appInfoPath) return new Map();

  try {
    return await readSteamAppInfo(appInfoPath, appIds);
  } catch (error) {
    steamSyncLogger.error(
      `Failed to read Steam app info from ${appInfoPath}`,
      error
    );
    return new Map();
  }
};

export const getInstalledSteamApps = async (): Promise<InstalledSteamApp[]> =>
  listInstalledSteamApps(await getSteamLibraryFolders().catch(() => []));
