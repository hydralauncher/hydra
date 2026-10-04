import {
  buildSteamGameLaunchUrl,
  getSteamCompatibilityPrefixPath,
} from "./steam-installation-core";
import { findSteamAppInstallDirectoryForExecutable } from "./steam-library-executable";

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
  const installDirectory = await findSteamAppInstallDirectoryForExecutable(
    appId,
    executablePath
  );

  if (!installDirectory) return null;

  return {
    url: buildSteamGameLaunchUrl(appId, launchOptions),
    installDirectory,
    compatibilityPrefixPath: getSteamCompatibilityPrefixPath(
      installDirectory,
      appId
    ),
  };
};
