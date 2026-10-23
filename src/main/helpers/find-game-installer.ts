import fs from "node:fs";
import path from "node:path";

import type { Download } from "@types";
import { logger } from "@main/services/logger";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import {
  isRedistributableDirectory,
  isThirdPartyInstallerPath,
} from "./game-executable-ranking";

const MAX_INSTALLER_DEPTH = 2;

const INSTALLER_NAME_PATTERNS = [/^setup\.exe$/, /^(setup|install).*\.exe$/];

interface InstallerCandidate {
  filePath: string;
  depth: number;
  priority: number;
}

const installerPriorityOf = (fileName: string) =>
  INSTALLER_NAME_PATTERNS.findIndex((pattern) =>
    pattern.test(fileName.toLowerCase())
  );

const collectInstallerCandidates = async (
  rootPath: string,
  directoryPath: string,
  depth: number
): Promise<InstallerCandidate[]> => {
  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
  } catch (err) {
    logger.error(
      `[findGameInstaller] Error reading folder ${directoryPath}:`,
      err
    );
    return [];
  }

  const candidates: InstallerCandidate[] = [];
  const subdirectories: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (
        depth < MAX_INSTALLER_DEPTH &&
        !isRedistributableDirectory(entry.name)
      ) {
        subdirectories.push(entryPath);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    const priority = installerPriorityOf(entry.name);
    if (priority === -1) continue;
    if (isThirdPartyInstallerPath(path.relative(rootPath, entryPath))) continue;

    candidates.push({ filePath: entryPath, depth, priority });
  }

  const nestedCandidates = await Promise.all(
    subdirectories.map((subdirectory) =>
      collectInstallerCandidates(rootPath, subdirectory, depth + 1)
    )
  );

  return [...candidates, ...nestedCandidates.flat()];
};

const SECONDARY_INSTALLER_PATTERN = /dlc|patch|update|addon|soundtrack|ost/;

const isSecondaryInstaller = (filePath: string) =>
  SECONDARY_INSTALLER_PATTERN.test(path.basename(filePath).toLowerCase());

const compareCandidates = (a: InstallerCandidate, b: InstallerCandidate) =>
  a.depth - b.depth ||
  a.priority - b.priority ||
  Number(isSecondaryInstaller(a.filePath)) -
    Number(isSecondaryInstaller(b.filePath)) ||
  path.basename(a.filePath).length - path.basename(b.filePath).length;

export const findGameInstaller = async (
  folderPath: string
): Promise<string | null> => {
  const candidates = await collectInstallerCandidates(
    folderPath,
    folderPath,
    0
  );
  candidates.sort(compareCandidates);
  const [best, runnerUp] = candidates;

  if (!best) return null;
  if (runnerUp && compareCandidates(best, runnerUp) === 0) return null;

  return best.filePath;
};

export const getDownloadFolderPath = async (download: Download) =>
  download.folderName
    ? path.join(
        download.downloadPath ?? (await getDownloadsPath()),
        download.folderName
      )
    : null;

export const getSourceArchivePath = async (download: Download) => {
  if (!download.sourceArchiveName) return null;

  const downloadPath = download.downloadPath ?? (await getDownloadsPath());
  const archivePath = path.join(downloadPath, download.sourceArchiveName);
  const folderPath = await getDownloadFolderPath(download);
  const relativePath = path.relative(downloadPath, archivePath);

  if (archivePath === folderPath) return null;
  if (
    relativePath.split(path.sep)[0] === ".." ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  return archivePath;
};

export const findSourceArchiveFile = async (download: Download) => {
  const archivePath = await getSourceArchivePath(download);
  if (!archivePath) return null;

  const stats = await fs.promises.stat(archivePath).catch(() => null);
  return stats?.isFile() ? archivePath : null;
};

const ARCHIVE_VOLUME_PATTERNS = [
  /^(.*)\.part\d+\.rar$/i,
  /^(.*\.(?:7z|zip|rar))\.\d{3}$/i,
];

const isVolumeOf = (fileName: string, archiveBase: string) =>
  ARCHIVE_VOLUME_PATTERNS.some((pattern) => {
    const match = pattern.exec(fileName);
    return match?.[1].toLowerCase() === archiveBase.toLowerCase();
  });

export const listArchiveVolumes = async (archivePath: string) => {
  const archiveName = path.basename(archivePath);
  const archiveBase = ARCHIVE_VOLUME_PATTERNS.map((pattern) =>
    pattern.exec(archiveName)
  ).find(Boolean)?.[1];

  if (!archiveBase) return [archivePath];

  const directory = path.dirname(archivePath);
  const entries = await fs.promises
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);

  const volumes = entries
    .filter((entry) => entry.isFile() && isVolumeOf(entry.name, archiveBase))
    .map((entry) => path.join(directory, entry.name));

  return volumes.length > 0 ? volumes : [archivePath];
};

export const findDownloadInstaller = async (
  download: Download | undefined | null
): Promise<string | null> => {
  if (!download || process.platform === "darwin") return null;

  const folderPath = await getDownloadFolderPath(download);
  if (!folderPath) return null;

  const stats = await fs.promises.stat(folderPath).catch(() => null);
  if (!stats?.isDirectory()) return null;

  return findGameInstaller(folderPath);
};
