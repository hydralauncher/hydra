import fs from "node:fs";
import path from "node:path";

const APP_MANIFEST_PATTERN = /^appmanifest_(\d+)\.acf$/i;

const readManifestValue = (content: string, key: string): string | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`"${escapedKey}"\\s*"((?:\\\\.|[^"\\\\])*)"`, "i")
  );

  if (!match) return null;

  return match[1].replaceAll("\\\\", "\\").replaceAll('\\"', '"');
};

const resolveInstallDirectory = (
  libraryFolder: string,
  installDirectoryName: string
): string | null => {
  const commonDirectory = path.resolve(libraryFolder, "steamapps", "common");
  const installDirectory = path.resolve(commonDirectory, installDirectoryName);
  const relative = path.relative(commonDirectory, installDirectory);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return installDirectory;
};

export const isPathInsideSteamInstallDirectory = (
  filePath: string,
  installDirectory: string,
  platform: NodeJS.Platform = process.platform
): boolean => {
  const paths = platform === "win32" ? path.win32 : path.posix;
  if (!paths.isAbsolute(filePath) || !paths.isAbsolute(installDirectory)) {
    return false;
  }

  const comparableFilePath =
    platform === "win32" ? filePath.toLowerCase() : filePath;
  const comparableInstallDirectory =
    platform === "win32" ? installDirectory.toLowerCase() : installDirectory;
  const relative = paths.relative(
    comparableInstallDirectory,
    comparableFilePath
  );

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${paths.sep}`) &&
    !paths.isAbsolute(relative)
  );
};

export const getSteamCompatibilityPrefixPath = (
  installDirectory: string,
  appId: string
) =>
  path.join(
    path.dirname(path.dirname(installDirectory)),
    "compatdata",
    appId,
    "pfx"
  );

export const buildSteamGameLaunchUrl = (
  appId: string,
  launchOptions?: string | null
) => {
  const launchOptionsValue = launchOptions?.trim();
  const commandPlaceholderIndex =
    launchOptionsValue?.indexOf("%command%") ?? -1;
  const args =
    commandPlaceholderIndex >= 0
      ? launchOptionsValue
          ?.slice(commandPlaceholderIndex + "%command%".length)
          .trim()
      : launchOptionsValue;

  if (!args) {
    return `steam://rungameid/${appId}`;
  }

  return `steam://run/${appId}//${encodeURIComponent(args)}/`;
};

const STEAM_APP_STATE_FULLY_INSTALLED = 4;

export interface InstalledSteamApp {
  appId: string;
  name: string | null;
  installDirectory: string;
}

const readInstalledSteamApp = async (
  libraryFolder: string,
  manifestPath: string,
  fileNameAppId: string
): Promise<InstalledSteamApp | null> => {
  const content = await fs.promises
    .readFile(manifestPath, "utf8")
    .catch(() => null);

  if (!content || readManifestValue(content, "appid") !== fileNameAppId) {
    return null;
  }

  const stateFlags = Number(readManifestValue(content, "StateFlags"));
  if (
    !Number.isInteger(stateFlags) ||
    (stateFlags & STEAM_APP_STATE_FULLY_INSTALLED) === 0
  ) {
    return null;
  }

  const installDirectoryName = readManifestValue(content, "installdir");
  if (!installDirectoryName) return null;

  const installDirectory = resolveInstallDirectory(
    libraryFolder,
    installDirectoryName
  );
  if (!installDirectory) return null;

  const isDirectory = await fs.promises
    .stat(installDirectory)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

  if (!isDirectory) return null;

  return {
    appId: fileNameAppId,
    name: readManifestValue(content, "name"),
    installDirectory,
  };
};

const pathExists = (filePath: string) =>
  fs.promises
    .access(filePath)
    .then(() => true)
    .catch(() => false);

export const isStaleSteamLibraryExecutable = async (
  executablePath: string,
  libraryFolders: string[],
  platform: NodeJS.Platform = process.platform
): Promise<boolean> => {
  const libraryFolder = libraryFolders.find((folder) =>
    isPathInsideSteamInstallDirectory(
      executablePath,
      path.join(folder, "steamapps", "common"),
      platform
    )
  );

  if (!libraryFolder || (await pathExists(executablePath))) return false;

  return pathExists(path.join(libraryFolder, "steamapps"));
};

export const steamAppIdFromManifestFileName = (
  fileName: string
): string | null => /^appmanifest_(\d+)\.acf/i.exec(fileName)?.[1] ?? null;

export const findInstalledSteamApp = async (
  appId: string,
  libraryFolders: string[]
): Promise<InstalledSteamApp | null> => {
  if (!/^\d+$/.test(appId)) return null;

  for (const libraryFolder of libraryFolders) {
    const installedApp = await readInstalledSteamApp(
      libraryFolder,
      path.join(libraryFolder, "steamapps", `appmanifest_${appId}.acf`),
      appId
    );

    if (installedApp) return installedApp;
  }

  return null;
};

export const listInstalledSteamApps = async (
  libraryFolders: string[]
): Promise<InstalledSteamApp[]> => {
  const installedApps = new Map<string, InstalledSteamApp>();

  for (const libraryFolder of libraryFolders) {
    const steamAppsDirectory = path.join(libraryFolder, "steamapps");
    const entries = await fs.promises
      .readdir(steamAppsDirectory, { withFileTypes: true })
      .catch(() => [] as fs.Dirent[]);

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const fileNameAppId = entry.name.match(APP_MANIFEST_PATTERN)?.[1];
      if (!fileNameAppId || installedApps.has(fileNameAppId)) continue;

      const installedApp = await readInstalledSteamApp(
        libraryFolder,
        path.join(steamAppsDirectory, entry.name),
        fileNameAppId
      );

      if (installedApp) installedApps.set(fileNameAppId, installedApp);
    }
  }

  return [...installedApps.values()];
};

export const findSteamAppInstallDirectories = async (
  appIds: Iterable<string>,
  libraryFolders: string[]
): Promise<Map<string, string>> => {
  const wantedAppIds = new Set(
    [...appIds].filter((appId) => /^\d+$/.test(appId))
  );
  const installDirectories = new Map<string, string>();

  if (wantedAppIds.size === 0) return installDirectories;

  for (const libraryFolder of libraryFolders) {
    const steamAppsDirectory = path.join(libraryFolder, "steamapps");
    const entries = await fs.promises
      .readdir(steamAppsDirectory, { withFileTypes: true })
      .catch(() => [] as fs.Dirent[]);

    for (const entry of entries) {
      if (!entry.isFile()) continue;

      const fileNameMatch = entry.name.match(APP_MANIFEST_PATTERN);
      const fileNameAppId = fileNameMatch?.[1];

      if (!fileNameAppId || !wantedAppIds.has(fileNameAppId)) continue;
      if (installDirectories.has(fileNameAppId)) continue;

      const content = await fs.promises
        .readFile(path.join(steamAppsDirectory, entry.name), "utf8")
        .catch(() => null);

      if (!content || readManifestValue(content, "appid") !== fileNameAppId) {
        continue;
      }

      const installDirectoryName = readManifestValue(content, "installdir");
      if (!installDirectoryName) continue;

      const installDirectory = resolveInstallDirectory(
        libraryFolder,
        installDirectoryName
      );
      if (!installDirectory) continue;

      const isDirectory = await fs.promises
        .stat(installDirectory)
        .then((stats) => stats.isDirectory())
        .catch(() => false);

      if (isDirectory) {
        installDirectories.set(fileNameAppId, installDirectory);
      }
    }
  }

  return installDirectories;
};
