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
