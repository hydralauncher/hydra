import fs from "node:fs";
import path from "node:path";

import { logger } from "@main/services/logger";
import {
  rankExecutableCandidates,
  type ExecutableSearchScope,
  type KnownGameExecutable,
} from "./game-executable-ranking";

export const findGameExecutableInFolder = async (
  folderPath: string,
  executables: KnownGameExecutable[],
  scope: ExecutableSearchScope = "installation"
): Promise<string | null> => {
  if (executables.length === 0) return null;

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

  const relativeFilePaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const parentPath =
      "parentPath" in entry
        ? entry.parentPath
        : ((entry as unknown as { path?: string }).path ?? folderPath);

    relativeFilePaths.push(
      path.relative(folderPath, path.join(parentPath, entry.name))
    );
  }

  const match = rankExecutableCandidates(relativeFilePaths, executables, scope);

  return match ? path.join(folderPath, match) : null;
};
