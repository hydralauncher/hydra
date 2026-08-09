import path from "node:path";
import fs from "node:fs";

const ACHIEVEMENTS_FILE_NAME = "achievements.json";

const readDirectory = async (dirPath: string) => {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
};

const findAchievementsFile = (entries: fs.Dirent[], dirPath: string) => {
  const match = entries.find(
    (entry) =>
      !entry.isDirectory() &&
      entry.name.toLowerCase() === ACHIEVEMENTS_FILE_NAME
  );

  return match ? path.join(dirPath, match.name) : null;
};

export const scanObjectIdFolder = async (objectIdPath: string) => {
  const entries = await readDirectory(objectIdPath);

  if (!entries) return [];

  const filePaths: string[] = [];

  const ownFilePath = findAchievementsFile(entries, objectIdPath);

  if (ownFilePath) filePaths.push(ownFilePath);

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const subfolderPath = path.join(objectIdPath, entry.name);
        const subfolderEntries = await readDirectory(subfolderPath);

        if (!subfolderEntries) return;

        const filePath = findAchievementsFile(subfolderEntries, subfolderPath);

        if (filePath) filePaths.push(filePath);
      })
  );

  return filePaths;
};

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
