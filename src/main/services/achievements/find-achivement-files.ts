import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import type { AchievementFile } from "@types";
import { Cracker } from "@shared";
import { Game } from "@main/entity";
import { achievementsLogger } from "../logger";

//TODO: change to a automatized method
const publicDocuments = path.join("C:", "Users", "Public", "Documents");
const programData = path.join("C:", "ProgramData");
const appData = app.getPath("appData");
const documents = app.getPath("documents");
const localAppData = path.join(appData, "..", "Local");

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
  Cracker.flt,
];

const getPathFromCracker = async (cracker: Cracker) => {
  if (cracker === Cracker.codex) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "CODEX"),
        fileLocation: ["achievements.ini"],
      },
      {
        folderPath: path.join(appData, "Steam", "CODEX"),
        fileLocation: ["achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.rune) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "RUNE"),
        fileLocation: ["achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.onlineFix) {
    return [
      {
        folderPath: path.join(publicDocuments, Cracker.onlineFix),
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

  if (cracker === Cracker.userstats) {
    return [];
  }

  if (cracker === Cracker.rld) {
    return [
      {
        folderPath: path.join(programData, "RLD!"),
        fileLocation: ["achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "Player"),
        fileLocation: ["stats", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.empress) {
    return [
      {
        folderPath: path.join(appData, "EMPRESS", "remote"),
        fileLocation: ["achievements.json"],
      },
      {
        folderPath: path.join(publicDocuments, "EMPRESS", "remote"),
        fileLocation: ["achievements.json"],
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
      {
        folderPath: path.join(localAppData, "SKIDROW"),
        fileLocation: ["SteamEmu", "UserStats", "achiev.ini"],
      },
    ];
  }

  if (cracker === Cracker.creamAPI) {
    return [
      {
        folderPath: path.join(appData, "CreamAPI"),
        fileLocation: ["stats", "CreamAPI.Achievements.cfg"],
      },
    ];
  }

  if (cracker === Cracker.smartSteamEmu) {
    return [
      {
        folderPath: path.join(appData, "SmartSteamEmu"),
        fileLocation: ["User", "Achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker._3dm) {
    return [];
  }

  if (cracker === Cracker.flt) {
    return [
      {
        folderPath: path.join(appData, "FLT"),
        fileLocation: ["stats"],
      },
    ];
  }

  if (cracker == Cracker.rle) {
    return [
      {
        folderPath: path.join(appData, "RLE"),
        fileLocation: ["achievements.ini"],
      },
      {
        folderPath: path.join(appData, "RLE"),
        fileLocation: ["Achievements.ini"],
      },
    ];
  }

  achievementsLogger.error(`Cracker ${cracker} not implemented`);
  throw new Error(`Cracker ${cracker} not implemented`);
};

const getAlternativeObjectIds = (objectId: string) => {
  if (objectId === "205100") {
    return ["205100", "217980", "31292"];
  }

  return [objectId];
};

export const findAchievementFiles = async (game: Game) => {
  const achievementFiles: AchievementFile[] = [];

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of await getPathFromCracker(
      cracker
    )) {
      for (const objectId of getAlternativeObjectIds(game.objectID)) {
        const filePath = path.join(folderPath, objectId, ...fileLocation);

        if (fs.existsSync(filePath)) {
          achievementFiles.push({
            type: cracker,
            filePath,
          });
        }
      }
    }
  }

  return achievementFiles;
};

export const findAchievementFileInExecutableDirectory = (
  game: Game
): AchievementFile[] => {
  if (!game.executablePath) {
    return [];
  }

  return [
    {
      type: Cracker.userstats,
      filePath: path.join(
        game.executablePath,
        "..",
        "SteamData",
        "user_stats.ini"
      ),
    },
    {
      type: Cracker._3dm,
      filePath: path.join(
        game.executablePath,
        "..",
        "3DMGAME",
        "Player",
        "stats",
        "achievements.ini"
      ),
    },
  ];
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
