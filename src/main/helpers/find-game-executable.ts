import fs from "node:fs";
import path from "node:path";

import { logger } from "@main/services/logger";
import {
  rankExecutableCandidates,
  type ExecutableSearchScope,
  type KnownGameExecutable,
} from "./game-executable-ranking";

const readEntriesUpToDepth = async (
  folderPath: string,
  maxDepth: number
): Promise<fs.Dirent[]> => {
  const entries = await fs.promises.readdir(folderPath, {
    withFileTypes: true,
  });
  if (maxDepth <= 0) return entries;

  const nested = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        readEntriesUpToDepth(
          path.join(folderPath, entry.name),
          maxDepth - 1
        ).catch(() => [])
      )
  );

  return [...entries, ...nested.flat()];
};

export const findGameExecutableInFolder = async (
  folderPath: string,
  executables: KnownGameExecutable[],
  scope: ExecutableSearchScope = "installation",
  maxDepth?: number
): Promise<string | null> => {
  if (executables.length === 0) return null;

  let entries: fs.Dirent[];

  try {
    entries =
      maxDepth === undefined
        ? await fs.promises.readdir(folderPath, {
            withFileTypes: true,
            recursive: true,
          })
        : await readEntriesUpToDepth(folderPath, maxDepth);
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
