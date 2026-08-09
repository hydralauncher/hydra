import type { AchievementFile } from "@types";
import { Cracker } from "@shared";

import { achievementsLogger } from "../logger";
import { getEmulatorSaveFolders } from "./find-achievement-files";
import { scanSaveFolder } from "./scan-nested-achievement-files";

export type NestedAchievementFiles = Map<string, AchievementFile[]>;

export const findNestedAchievementFiles = async (
  winePrefixPath = ""
): Promise<NestedAchievementFiles> => {
  const files: NestedAchievementFiles = new Map();

  try {
    for (const folderPath of getEmulatorSaveFolders(winePrefixPath)) {
      const filePathsByObjectId = await scanSaveFolder(folderPath);

      for (const [objectId, filePaths] of filePathsByObjectId) {
        const objectIdFiles = files.get(objectId) ?? [];

        objectIdFiles.push(
          ...filePaths.map((filePath) => ({
            type: Cracker.goldberg,
            filePath,
          }))
        );

        files.set(objectId, objectIdFiles);
      }
    }
  } catch (error) {
    achievementsLogger.error(
      "Failed to scan for nested achievement files",
      error
    );
  }

  return files;
};
