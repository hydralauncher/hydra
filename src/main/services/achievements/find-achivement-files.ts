import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import type { AchievementFile } from "@types";
import { Cracker } from "@shared";
import { Game } from "@main/entity";

//TODO: change to a automatized method
const publicDir = path.join("C:", "Users", "Public", "Documents");
const programData = path.join("C:", "ProgramData");
const appData = app.getPath("appData");

const crackers = [
  Cracker.codex,
  Cracker.goldberg,
  Cracker.goldberg2,
  Cracker.rune,
  Cracker.onlineFix,
  Cracker.userstats,
  Cracker.rld,
];

const getPathFromCracker = (cracker: Cracker) => {
  let folderPath: string;
  let fileLocation: string[];

  if (cracker === Cracker.onlineFix) {
    folderPath = path.join(publicDir, Cracker.onlineFix);
    fileLocation = ["Stats", "Achievements.ini"];
  } else if (cracker === Cracker.goldberg) {
    folderPath = path.join(appData, "Goldberg SteamEmu Saves");
    fileLocation = ["achievements.json"];
  } else if (cracker === Cracker.goldberg2) {
    folderPath = path.join(appData, "GSE Saves");
    fileLocation = ["achievements.json"];
  } else if (cracker === Cracker.rld) {
    folderPath = path.join(programData, Cracker.rld);
    fileLocation = ["achievements.ini"];
  } else {
    folderPath = path.join(publicDir, "Steam", cracker);
    fileLocation = ["achievements.ini"];
  }

  return { folderPath, fileLocation };
};

export const findAchievementFiles = (game: Game) => {
  const achievementFiles: AchievementFile[] = [];

  for (const cracker of crackers) {
    const { folderPath, fileLocation } = getPathFromCracker(cracker);

    const filePath = path.join(folderPath, game.objectID, ...fileLocation);

    if (fs.existsSync(filePath)) {
      achievementFiles.push({
        type: cracker,
        filePath: path.join(folderPath, game.objectID, ...fileLocation),
      });
    }
  }

  return achievementFiles;
};

export const findAchievementFileInExecutableDirectory = (
  game: Game
): AchievementFile | null => {
  if (!game.executablePath) {
    return null;
  }

  const steamDataPath = path.join(
    game.executablePath,
    "..",
    "SteamData",
    "user_stats.ini"
  );

  return {
    type: Cracker.userstats,
    filePath: steamDataPath,
  };
};

export const findAllAchievementFiles = () => {
  const gameAchievementFiles = new Map<string, AchievementFile[]>();

  for (const cracker of crackers) {
    const { folderPath, fileLocation } = getPathFromCracker(cracker);

    if (!fs.existsSync(folderPath)) {
      return gameAchievementFiles;
    }

    const objectIds = fs.readdirSync(folderPath);

    for (const objectId of objectIds) {
      const filePath = path.join(folderPath, objectId, ...fileLocation);

      if (!fs.existsSync(filePath)) continue;

      const achivementFile = {
        type: cracker,
        filePath,
      };

      gameAchievementFiles.get(objectId)
        ? gameAchievementFiles.get(objectId)!.push(achivementFile)
        : gameAchievementFiles.set(objectId, [achivementFile]);
    }
  }

  return gameAchievementFiles;
};
