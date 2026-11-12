import { getSteamLibraryFolders } from "../steam";
import { findSteamAppInstallDirectories } from "./steam-installation-core";

export const getSteamAppInstallDirectories = async (
  appIds: Iterable<string>
): Promise<Map<string, string>> =>
  findSteamAppInstallDirectories(appIds, await getSteamLibraryFolders());
