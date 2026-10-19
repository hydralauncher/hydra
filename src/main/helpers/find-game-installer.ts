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

const compareCandidates = (a: InstallerCandidate, b: InstallerCandidate) =>
  a.depth - b.depth || a.priority - b.priority;

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
