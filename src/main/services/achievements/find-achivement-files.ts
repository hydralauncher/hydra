import path from "node:path";
import fs from "node:fs";
import type { Game, AchievementFile, UserPreferences } from "@types";
import { Cracker } from "@shared";
import { achievementsLogger } from "../logger";
import { SystemPath } from "../system-path";
import { getSteamLocation, getSteamUsersIds } from "../steam";
import { db, levelKeys } from "@main/level";

const getAppDataPath = () => {
  if (process.platform === "win32") {
    return SystemPath.getPath("appData");
  }

  const user = SystemPath.getPath("home").split("/").pop();

  return path.join("drive_c", "users", user || "", "AppData", "Roaming");
};

const getDocumentsPath = () => {
  if (process.platform === "win32") {
    return SystemPath.getPath("documents");
  }

  const user = SystemPath.getPath("home").split("/").pop();

  return path.join("drive_c", "users", user || "", "Documents");
};

const getPublicDocumentsPath = () => {
  if (process.platform === "win32") {
    return path.join("C:", "Users", "Public", "Documents");
  }

  return path.join("drive_c", "users", "Public", "Documents");
};

const getLocalAppDataPath = () => {
  if (process.platform === "win32") {
    return path.join(appData, "..", "Local");
  }

  const user = SystemPath.getPath("home").split("/").pop();

  return path.join("drive_c", "users", user || "", "AppData", "Local");
};

const getProgramDataPath = () => {
  if (process.platform === "win32") {
    return path.join("C:", "ProgramData");
  }

  return path.join("drive_c", "ProgramData");
};

//TODO: change to a automatized method
const publicDocuments = getPublicDocumentsPath();
const programData = getProgramDataPath();
const appData = getAppDataPath();
const documents = getDocumentsPath();
const localAppData = getLocalAppDataPath();

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
  Cracker.razor1911,
];

const getPathFromCracker = (cracker: Cracker) => {
  if (cracker === Cracker.codex) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "CODEX"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(appData, "Steam", "CODEX"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.rune) {
    return [
      {
        folderPath: path.join(publicDocuments, "Steam", "RUNE"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.onlineFix) {
    return [
      {
        folderPath: path.join(publicDocuments, "OnlineFix"),
        fileLocation: ["<objectId>", "Stats", "Achievements.ini"],
      },
      {
        folderPath: path.join(publicDocuments, "OnlineFix"),
        fileLocation: ["<objectId>", "Achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.goldberg) {
    return [
      {
        folderPath: path.join(appData, "Goldberg SteamEmu Saves"),
        fileLocation: ["<objectId>", "achievements.json"],
      },
      {
        folderPath: path.join(appData, "GSE Saves"),
        fileLocation: ["<objectId>", "achievements.json"],
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
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "Player"),
        fileLocation: ["<objectId>", "stats", "achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "RLD!"),
        fileLocation: ["<objectId>", "stats", "achievements.ini"],
      },
      {
        folderPath: path.join(programData, "Steam", "dodi"),
        fileLocation: ["<objectId>", "stats", "achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker.empress) {
    return [
      {
        folderPath: path.join(appData, "EMPRESS", "remote"),
        fileLocation: ["<objectId>", "achievements.json"],
      },
      {
        folderPath: path.join(publicDocuments, "EMPRESS"),
        fileLocation: [
          "<objectId>",
          "remote",
          "<objectId>",
          "achievements.json",
        ],
      },
    ];
  }

  if (cracker === Cracker.skidrow) {
    return [
      {
        folderPath: path.join(documents, "SKIDROW"),
        fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
      },
      {
        folderPath: path.join(documents, "Player"),
        fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
      },
      {
        folderPath: path.join(localAppData, "SKIDROW"),
        fileLocation: ["<objectId>", "SteamEmu", "UserStats", "achiev.ini"],
      },
    ];
  }

  if (cracker === Cracker.creamAPI) {
    return [
      {
        folderPath: path.join(appData, "CreamAPI"),
        fileLocation: ["<objectId>", "stats", "CreamAPI.Achievements.cfg"],
      },
    ];
  }

  if (cracker === Cracker.smartSteamEmu) {
    return [
      {
        folderPath: path.join(appData, "SmartSteamEmu"),
        fileLocation: ["<objectId>", "User", "Achievements.ini"],
      },
    ];
  }

  if (cracker === Cracker._3dm) {
    return [];
  }

  if (cracker === Cracker.flt) {
    return [
      // {
      //   folderPath: path.join(appData, "FLT"),
      //   fileLocation: ["stats"],
      // },
    ];
  }

  if (cracker == Cracker.rle) {
    return [
      {
        folderPath: path.join(appData, "RLE"),
        fileLocation: ["<objectId>", "achievements.ini"],
      },
      {
        folderPath: path.join(appData, "RLE"),
        fileLocation: ["<objectId>", "Achievements.ini"],
      },
    ];
  }

  if (cracker == Cracker.razor1911) {
    return [
      {
        folderPath: path.join(appData, ".1911"),
        fileLocation: ["<objectId>", "achievement"],
      },
    ];
  }

  achievementsLogger.error(`Cracker ${cracker} not implemented`);
  throw new Error(`Cracker ${cracker} not implemented`);
};

export const getAlternativeObjectIds = (objectId: string) => {
  // Dishonored
  if (objectId === "205100") {
    return ["205100", "217980", "31292"];
  }

  return [objectId];
};

export const findAchievementFiles = (game: Game) => {
  const achievementFiles: AchievementFile[] = [];

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of getPathFromCracker(cracker)) {
      for (const objectId of getAlternativeObjectIds(game.objectId)) {
        const filePath = path.join(
          game.winePrefixPath ?? "",
          folderPath,
          ...mapFileLocationWithObjectId(fileLocation, objectId)
        );

        if (fs.existsSync(filePath)) {
          achievementFiles.push({
            type: cracker,
            filePath,
          });
        }
      }
    }
  }

  const achievementFileInsideDirectory =
    findAchievementFileInExecutableDirectory(game);

  return achievementFiles.concat(achievementFileInsideDirectory);
};

const steamUserIds = await getSteamUsersIds();
const steamPath = await getSteamLocation().catch(() => null);

export const findAchievementFileInSteamPath = async (game: Game) => {
  if (!steamUserIds.length) {
    return [];
  }

  if (!steamPath) {
    return [];
  }

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!userPreferences?.enableSteamAchievements) {
    return [];
  }

  const achievementFiles: AchievementFile[] = [];

  for (const steamUserId of steamUserIds) {
    const gameAchievementPath = path.join(
      steamPath,
      "userdata",
      steamUserId.toString(),
      "config",
      "librarycache",
      `${game.objectId}.json`
    );

    if (fs.existsSync(gameAchievementPath)) {
      achievementFiles.push({
        type: Cracker.Steam,
        filePath: gameAchievementPath,
      });
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
        game.winePrefixPath ?? "",
        game.executablePath,
        "..",
        "SteamData",
        "user_stats.ini"
      ),
    },
    {
      type: Cracker._3dm,
      filePath: path.join(
        game.winePrefixPath ?? "",
        game.executablePath,
        "..",
        "3DMGAME",
        "Player",
        "stats",
        "achievements.ini"
      ),
    },
  ].filter((file) => fs.existsSync(file.filePath)) as AchievementFile[];
};

const mapFileLocationWithObjectId = (
  fileLocation: string[],
  objectId: string
) => {
  return fileLocation.map((location) =>
    location.replace("<objectId>", objectId)
  );
};

export const findAllAchievementFiles = () => {
  const gameAchievementFiles = new Map<string, AchievementFile[]>();

  for (const cracker of crackers) {
    for (const { folderPath, fileLocation } of getPathFromCracker(cracker)) {
      if (!fs.existsSync(folderPath)) {
        continue;
      }

      const objectIds = fs.readdirSync(folderPath);

      for (const objectId of objectIds) {
        const filePath = path.join(
          folderPath,
          ...mapFileLocationWithObjectId(fileLocation, objectId)
        );

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
