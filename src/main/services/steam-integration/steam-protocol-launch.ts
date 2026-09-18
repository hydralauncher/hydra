import fs from "node:fs";

import {
  buildSteamGameLaunchUrl,
  getSteamCompatibilityPrefixPath,
  isPathInsideSteamInstallDirectory,
} from "./steam-installation-core";
import { getSteamAppInstallDirectories } from "./steam-installation";

export interface SteamProtocolLaunch {
  url: string;
  installDirectory: string;
  compatibilityPrefixPath: string;
}

export const resolveSteamProtocolLaunch = async (
  appId: string,
  executablePath: string,
  launchOptions?: string | null
): Promise<SteamProtocolLaunch | null> => {
  const installDirectory = (await getSteamAppInstallDirectories([appId])).get(
    appId
  );

  if (
    !installDirectory ||
    !isPathInsideSteamInstallDirectory(executablePath, installDirectory)
  ) {
    return null;
  }

  const [realExecutablePath, realInstallDirectory] = await Promise.all([
    fs.promises.realpath(executablePath).catch(() => null),
    fs.promises.realpath(installDirectory).catch(() => null),
  ]);

  if (
    realExecutablePath &&
    realInstallDirectory &&
    !isPathInsideSteamInstallDirectory(realExecutablePath, realInstallDirectory)
  ) {
    return null;
  }

  return {
    url: buildSteamGameLaunchUrl(appId, launchOptions),
    installDirectory,
    compatibilityPrefixPath: getSteamCompatibilityPrefixPath(
      installDirectory,
      appId
    ),
  };
};
