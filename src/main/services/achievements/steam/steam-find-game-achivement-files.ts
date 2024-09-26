import path from "node:path";
import fs from "node:fs";
import { Cracker, GameAchievementFiles } from "../types";
import { app } from "electron";

const addGame = (
  achievementFiles: GameAchievementFiles,
  achievementPath: string,
  objectId: string,
  fileLocation: string[],
  type: Cracker
) => {
  const filePath = path.join(achievementPath, objectId, ...fileLocation);

  const achivementFile = {
    type,
    filePath,
  };

  achievementFiles[objectId]
    ? achievementFiles[objectId].push(achivementFile)
    : (achievementFiles[objectId] = [achivementFile]);
};

export const steamFindGameAchievementFiles = (
  objectId?: string
): GameAchievementFiles => {
  //TODO: change to a automatized method
  const publicDir = path.join("C:", "Users", "Public", "Documents");
  const appData = app.getPath("appData");

  const gameAchievementFiles: GameAchievementFiles = {};

  const crackers = [
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

    const objectIds = objectId ? [objectId] : fs.readdirSync(achievementPath);

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

  return gameAchievementFiles;
};
