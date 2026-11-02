import fs from "node:fs";
import { isPathInsideSteamInstallDirectory } from "./steam-installation-core";
import { getSteamAppInstallDirectories } from "./steam-installation";

export const findSteamAppInstallDirectoryForExecutable = async (
  appId: string,
  executablePath: string
): Promise<string | null> => {
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

  return installDirectory;
};

export const isSteamAppExecutable = async (
  appId: string,
  executablePath: string
): Promise<boolean> =>
  (await findSteamAppInstallDirectoryForExecutable(appId, executablePath)) !==
  null;
