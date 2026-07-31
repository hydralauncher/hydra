import fs from "node:fs";
import path from "node:path";

import { logger } from "@main/services/logger";

const IGNORED_GAME_EXECUTABLE_FOLDERS = new Set([
  "crack",
  "originalfiles",
  "voices38",
  "denuvowo",
  "rune",
  "codex",
  "goldberg",
  "fixrepair",
  "onlinefix",
]);

const normalizeFolderName = (folderName: string) =>
  folderName.toLowerCase().replace(/[^a-z0-9]/g, "");

const isIgnoredFolderName = (folderName: string) =>
  IGNORED_GAME_EXECUTABLE_FOLDERS.has(normalizeFolderName(folderName));

const isInsideIgnoredFolder = (rootPath: string, parentPath: string) =>
  path.relative(rootPath, parentPath).split(/[\\/]/).some(isIgnoredFolderName);

export const findGameExecutableInFolder = async (
  folderPath: string,
  executableNames: Iterable<string>
): Promise<string | null> => {
  const normalizedNames = new Set(
    Array.from(executableNames, (name) => name.toLowerCase())
  );

  if (normalizedNames.size === 0) return null;

  let entries: fs.Dirent[];

  try {
    entries = await fs.promises.readdir(folderPath, {
      withFileTypes: true,
      recursive: true,
    });
  } catch (err) {
    logger.error(
      `[findGameExecutableInFolder] Error reading folder ${folderPath}:`,
      err
    );
    return null;
  }

  let ignoredMatch: string | null = null;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!normalizedNames.has(entry.name.toLowerCase())) continue;

    const parentPath =
      "parentPath" in entry
        ? entry.parentPath
        : ((entry as unknown as { path?: string }).path ?? folderPath);

    const executablePath = path.join(parentPath, entry.name);

    if (!isInsideIgnoredFolder(folderPath, parentPath)) {
      return executablePath;
    }

    ignoredMatch ??= executablePath;
  }

  return ignoredMatch;
};
