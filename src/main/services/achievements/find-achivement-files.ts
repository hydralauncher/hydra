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
const documents = app.getPath("documents");

const crackers = [
  Cracker.codex,
  Cracker.goldberg,
  Cracker.rune,
  Cracker.onlineFix,
  Cracker.userstats,
  Cracker.rld,
  Cracker.creamAPI,
  Cracker.skidrow,
  Cracker.smartSteamEmu,
  Cracker.empress,
];

const getPathFromCracker = async (cracker: Cracker) => {
  if (cracker === Cracker.smartSteamEmu) {
    return [
      {
        folderPath: path.join(appData, "SmartSteamEmu"),
        fileLocation: ["User", "Achievements"],
      },
    ];
  }

  if (cracker === Cracker.onlineFix) {
    return [
      {
        folderPath: path.join(publicDir, Cracker.onlineFix),
        fileLocation: ["Stats", "Achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.goldberg) {
    return [
      {
        folderPath: path.join(appData, "Goldberg SteamEmu Saves"),
        fileLocation: ["achievements.json"],
      },
      {
        folderPath: path.join(appData, "GSE Saves"),
        fileLocation: ["achievements.json"],
      },
    ];
  }

  if (cracker === Cracker.rld) {
    return [
      {
        folderPath: path.join(programData, "RLD!"),
        fileLocation: ["achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.creamAPI) {
    return [
      {
        folderPath: path.join(appData, "CreamAPI"),
        fileLocation: ["achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.skidrow) {
    return [
      {
        folderPath: path.join(documents, "SKIDROW"),
        fileLocation: ["SteamEmu", "UserStats", "achiev.ini"],
      },
      {
        folderPath: path.join(documents, "Player"),
        fileLocation: ["SteamEmu", "UserStats", "achiev.ini"],
      },
    ];
  }

  if (cracker === Cracker.codex) {
    return [
      {
        folderPath: path.join(publicDir, "Steam", "CODEX"),
        fileLocation: ["achievements.ini"],
      },
      {
        folderPath: path.join(appData, "Steam", "CODEX"),
        fileLocation: ["achievements.ini"],
      },
    ];
  }

  return [
    {
      folderPath: path.join(publicDir, "Steam", cracker),
      fileLocation: ["achievements.ini"],
    },
  ];
};

export const findAchievementFiles = async (game: Game) => {
  const achievementFiles: AchievementFile[] = [];

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of await getPathFromCracker(
      cracker
    )) {
      const filePath = path.join(folderPath, game.objectID, ...fileLocation);

      if (fs.existsSync(filePath)) {
        achievementFiles.push({
          type: cracker,
          filePath,
        });
      }
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

export const findAllAchievementFiles = async () => {
  const gameAchievementFiles = new Map<string, AchievementFile[]>();

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of await getPathFromCracker(
      cracker
    )) {
      if (!fs.existsSync(folderPath)) {
        continue;
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
  }

  return gameAchievementFiles;
};
