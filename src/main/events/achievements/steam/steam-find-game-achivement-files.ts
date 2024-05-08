import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { Cracker, GameAchievementFiles } from "../types";
import { app } from "electron";

const addGame = (
  achievementFiles: GameAchievementFiles,
  gamePath: string,
  objectId: string,
  fileLocation: string[],
  type: Cracker
) => {
  const filePath = path.join(gamePath, objectId, ...fileLocation);

  if (existsSync(filePath)) {
    const achivementFile = {
      type,
      filePath: filePath,
    };

    achievementFiles[objectId]
      ? achievementFiles[objectId].push(achivementFile)
      : (achievementFiles[objectId] = [achivementFile]);
  }
};

export const steamFindGameAchievementFiles = (
  objectId?: string
): GameAchievementFiles => {
  //TODO: change to a automatized method
  const publicDir = path.join("C:", "Users", "Public", "Documents");
  const appData = app.getPath("appData");

  const gameAchievementFiles: GameAchievementFiles = {};

  const crackers: Cracker[] = [
    Cracker.codex,
    Cracker.goldberg,
    Cracker.rune,
    Cracker.onlineFix,
  ];

  for (const cracker of crackers) {
    let achievementPath: string;
    let fileLocation: string[];

    if (cracker === Cracker.onlineFix) {
      achievementPath = path.join(publicDir, Cracker.onlineFix);
      fileLocation = ["Stats", "Achievements.ini"];
    } else if (cracker === Cracker.goldberg) {
      achievementPath = path.join(appData, "Goldberg SteamEmu Saves");
      fileLocation = ["achievements.json"];
    } else {
      achievementPath = path.join(publicDir, "Steam", cracker);
      fileLocation = ["achievements.ini"];
    }

    if (!existsSync(achievementPath)) continue;

    const objectIds = readdirSync(achievementPath);

    if (objectId) {
      if (objectIds.includes(objectId)) {
        addGame(
          gameAchievementFiles,
          achievementPath,
          objectId,
          fileLocation,
          cracker
        );
      }
    } else {
      for (const objectId of objectIds) {
        addGame(
          gameAchievementFiles,
          achievementPath,
          objectId,
          fileLocation,
          cracker
        );
      }
    }
  }

  return gameAchievementFiles;
};
