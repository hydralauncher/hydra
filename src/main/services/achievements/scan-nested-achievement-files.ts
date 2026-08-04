import path from "node:path";
import fs from "node:fs";

const ACHIEVEMENTS_FILE_NAME = "achievements.json";

const MAX_DEPTH = 4;
const MAX_DIRECTORIES_PER_OBJECT_ID = 64;

const readDirectory = async (dirPath: string) => {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
};

/**
 * Breadth first so the shallow, realistic locations are always reached before
 * the budget can be spent on a bulky save folder such as `remote`.
 */
export const scanObjectIdFolder = async (objectIdPath: string) => {
  const filePaths: string[] = [];

  let currentLevel = [objectIdPath];
  let visitedDirectories = 0;

  for (let depth = 0; depth <= MAX_DEPTH && currentLevel.length; depth++) {
    const nextLevel: string[] = [];

    for (const dirPath of currentLevel) {
      if (visitedDirectories >= MAX_DIRECTORIES_PER_OBJECT_ID) break;

      visitedDirectories++;

      const entries = await readDirectory(dirPath);

      if (!entries) continue;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          nextLevel.push(path.join(dirPath, entry.name));
          continue;
        }

        if (entry.name.toLowerCase() === ACHIEVEMENTS_FILE_NAME) {
          filePaths.push(path.join(dirPath, entry.name));
        }
      }
    }

    currentLevel = nextLevel;
  }

  return filePaths;
};

/**
 * Walks a save folder that holds one subfolder per app id, collecting every
 * achievements file below each of them. The canonical
 * `<objectId>/achievements.json` is included, so callers that also use the
 * static path table must deduplicate.
 */
export const scanSaveFolder = async (folderPath: string) => {
  const filePathsByObjectId = new Map<string, string[]>();

  const objectIdEntries = await readDirectory(folderPath);

  if (!objectIdEntries) return filePathsByObjectId;

  await Promise.all(
    objectIdEntries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const filePaths = await scanObjectIdFolder(
          path.join(folderPath, entry.name)
        );

        if (filePaths.length) {
          filePathsByObjectId.set(entry.name, filePaths);
        }
      })
  );

  return filePathsByObjectId;
};
