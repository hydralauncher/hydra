import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import type { AchievementFile } from "@types";
import { Cracker } from "@shared";
import { Game } from "@main/entity";

//TODO: change to a automatized method
const publicDir = path.join("C:", "Users", "Public", "Documents");
const appData = app.getPath("appData");

const crackers = [
  Cracker.codex,
  Cracker.goldberg,
  Cracker.goldberg2,
  Cracker.rune,
  Cracker.onlineFix,
  Cracker.generic,
];

const addGame = (
  achievementFiles: Map<string, AchievementFile[]>,
  achievementPath: string,
  objectId: string,
  fileLocation: string[],
  type: Cracker
) => {
  const filePath = path.join(achievementPath, objectId, ...fileLocation);

  if (!fs.existsSync(filePath)) return;

  const achivementFile = {
    type,
    filePath,
  };

  achievementFiles.get(objectId)
    ? achievementFiles.get(objectId)!.push(achivementFile)
    : achievementFiles.set(objectId, [achivementFile]);
};

const getObjectIdsInFolder = (path: string) => {
  if (fs.existsSync(path)) {
    return fs.readdirSync(path);
  }

  return [];
};

export const findSteamGameAchievementFiles = (game: Game) => {
  const achievementFiles: AchievementFile[] = [];
  for (const cracker of crackers) {
    let achievementPath: string;
    let fileLocation: string[];

    if (cracker === Cracker.onlineFix) {
      achievementPath = path.join(publicDir, Cracker.onlineFix);
      fileLocation = ["Stats", "Achievements.ini"];
    } else if (cracker === Cracker.goldberg) {
      achievementPath = path.join(appData, "Goldberg SteamEmu Saves");
      fileLocation = ["achievements.json"];
    } else if (cracker === Cracker.goldberg2) {
      achievementPath = path.join(appData, "GSE Saves");
      fileLocation = ["achievements.json"];
    } else {
      achievementPath = path.join(publicDir, "Steam", cracker);
      fileLocation = ["achievements.ini"];
    }

    const filePath = path.join(achievementPath, game.objectID, ...fileLocation);

    if (fs.existsSync(filePath)) {
      achievementFiles.push({
        type: cracker,
        filePath: path.join(achievementPath, game.objectID, ...fileLocation),
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
    type: Cracker.generic,
    filePath: steamDataPath,
  };
};

export const findAllSteamGameAchievementFiles = () => {
  const gameAchievementFiles = new Map<string, AchievementFile[]>();

  for (const cracker of crackers) {
    let achievementPath: string;
    let fileLocation: string[];

    if (cracker === Cracker.onlineFix) {
      achievementPath = path.join(publicDir, Cracker.onlineFix);
      fileLocation = ["Stats", "Achievements.ini"];
    } else if (cracker === Cracker.goldberg2) {
      achievementPath = path.join(appData, "GSE Saves");
      fileLocation = ["achievements.json"];
    } else if (cracker === Cracker.goldberg) {
      achievementPath = path.join(appData, "Goldberg SteamEmu Saves");
      fileLocation = ["achievements.json"];
    } else {
      achievementPath = path.join(publicDir, "Steam", cracker);
      fileLocation = ["achievements.ini"];
    }

    const objectIds = getObjectIdsInFolder(achievementPath);

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
