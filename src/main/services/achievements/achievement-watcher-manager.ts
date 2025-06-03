import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import fs, { readdirSync } from "node:fs";
import {
  findAchievementFileInExecutableDirectory,
  findAchievementFiles,
  findAllAchievementFiles,
  getAlternativeObjectIds,
} from "./find-achivement-files";
import type {
  AchievementFile,
  Game,
  GameShop,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementsLogger } from "../logger";
import { Cracker } from "@shared";
import { publishCombinedNewAchievementNotification } from "../notifications";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "../window-manager";
import { setTimeout } from "node:timers/promises";

const fileStats: Map<string, number> = new Map();
const fltFiles: Map<string, Set<string>> = new Map();

const watchAchievementsWindows = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((games) => games.filter((game) => !game.isDeleted));

  if (games.length === 0) return;

  const achievementFiles = findAllAchievementFiles();

  for (const game of games) {
    const gameAchievementFiles: AchievementFile[] = [];

    for (const objectId of getAlternativeObjectIds(game.objectId)) {
      gameAchievementFiles.push(...(achievementFiles.get(objectId) ?? []));

      gameAchievementFiles.push(
        ...findAchievementFileInExecutableDirectory(game)
      );
    }

    for (const file of gameAchievementFiles) {
      compareFile(game, file);
    }
  }
};

const watchAchievementsWithWine = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((games) =>
      games.filter((game) => !game.isDeleted && game.winePrefixPath)
    );

  for (const game of games) {
    const gameAchievementFiles = findAchievementFiles(game);
    const achievementFileInsideDirectory =
      findAchievementFileInExecutableDirectory(game);

    gameAchievementFiles.push(...achievementFileInsideDirectory);

    for (const file of gameAchievementFiles) {
      compareFile(game, file);
    }
  }
};

const compareFltFolder = async (game: Game, file: AchievementFile) => {
  try {
    const currentAchievements = new Set(readdirSync(file.filePath));
    const previousAchievements = fltFiles.get(file.filePath);

    fltFiles.set(file.filePath, currentAchievements);
    if (
      !previousAchievements ||
      currentAchievements.difference(previousAchievements).size === 0
    ) {
      return;
    }

    achievementsLogger.log("Detected change in FLT folder", file.filePath);
    await processAchievementFileDiff(game, file);
  } catch (err) {
    achievementsLogger.error(err);
    fltFiles.set(file.filePath, new Set());
  }
};

const compareFile = (game: Game, file: AchievementFile) => {
  if (file.type === Cracker.flt) {
    return compareFltFolder(game, file);
  }

  try {
    const currentStat = fs.statSync(file.filePath);
    const previousStat = fileStats.get(file.filePath);
    fileStats.set(file.filePath, currentStat.mtimeMs);

    if (!previousStat || previousStat === -1) {
      if (currentStat.mtimeMs) {
        achievementsLogger.log(
          "First change in file",
          file.filePath,
          previousStat,
          currentStat.mtimeMs
        );

        return processAchievementFileDiff(game, file);
      }
    }

    if (previousStat === currentStat.mtimeMs) {
      return;
    }

    achievementsLogger.log(
      "Detected change in file",
      file.filePath,
      previousStat,
      currentStat.mtimeMs
    );
    return processAchievementFileDiff(game, file);
  } catch (err) {
    achievementsLogger.error(
      "Error reading file",
      file.filePath,
      err instanceof Error ? err.message : err
    );
    fileStats.set(file.filePath, -1);
    return;
  }
};

const processAchievementFileDiff = async (
  game: Game,
  file: AchievementFile
) => {
  const unlockedAchievements = parseAchievementFile(file.filePath, file.type);
  console.log("achievements length", unlockedAchievements.length);
  if (unlockedAchievements.length) {
    return mergeAchievements(game, unlockedAchievements, true);
  }

  return 0;
};

export class AchievementWatcherManager {
  private static _hasFinishedPreSearch = false;

  public static get hasFinishedPreSearch() {
    return this._hasFinishedPreSearch;
  }

  public static readonly alreadySyncedGames: Map<string, boolean> = new Map();

  public static async firstSyncWithRemoteIfNeeded(
    shop: GameShop,
    objectId: string
  ) {
    const gameKey = levelKeys.game(shop, objectId);
    if (this.alreadySyncedGames.get(gameKey)) return;

    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game) return;

    const gameAchievementFiles = findAchievementFiles(game);

    const achievementFileInsideDirectory =
      findAchievementFileInExecutableDirectory(game);

    gameAchievementFiles.push(...achievementFileInsideDirectory);

    const unlockedAchievements: UnlockedAchievement[] = [];

    for (const achievementFile of gameAchievementFiles) {
      const localAchievementFile = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      if (localAchievementFile.length) {
        unlockedAchievements.push(...localAchievementFile);
      }
    }

    this.alreadySyncedGames.set(gameKey, true);

    return mergeAchievements(game, unlockedAchievements, false);
  }

  public static watchAchievements() {
    if (!this.hasFinishedPreSearch) return;

    if (process.platform === "win32") {
      return watchAchievementsWindows();
    }

    return watchAchievementsWithWine();
  }

  private static preProcessGameAchievementFiles(
    game: Game,
    gameAchievementFiles: AchievementFile[]
  ) {
    const unlockedAchievements: UnlockedAchievement[] = [];
    for (const achievementFile of gameAchievementFiles) {
      const parsedAchievements = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      try {
        const currentStat = fs.statSync(achievementFile.filePath);
        fileStats.set(achievementFile.filePath, currentStat.mtimeMs);
      } catch {
        fileStats.set(achievementFile.filePath, -1);
      }

      if (parsedAchievements.length) {
        unlockedAchievements.push(...parsedAchievements);

        achievementsLogger.log(
          "Achievement file for",
          game.title,
          achievementFile.filePath,
          parsedAchievements
        );
      }
    }

    if (unlockedAchievements.length) {
      return mergeAchievements(game, unlockedAchievements, false);
    }

    return 0;
  }

  private static async getGameAchievementFilesWindows() {
    const games = await gamesSublevel
      .values()
      .all()
      .then((games) => games.filter((game) => !game.isDeleted));

    const gameAchievementFilesMap = findAllAchievementFiles();

    return Promise.all(
      games.map((game) => {
        const achievementFiles: AchievementFile[] = [];

        for (const objectId of getAlternativeObjectIds(game.objectId)) {
          achievementFiles.push(
            ...(gameAchievementFilesMap.get(objectId) || [])
          );

          achievementFiles.push(
            ...findAchievementFileInExecutableDirectory(game)
          );
        }

        return { game, achievementFiles };
      })
    );
  }

  private static async getGameAchievementFilesLinux() {
    const games = await gamesSublevel
      .values()
      .all()
      .then((games) => games.filter((game) => !game.isDeleted));

    return Promise.all(
      games.map((game) => {
        const achievementFiles = findAchievementFiles(game);
        const achievementFileInsideDirectory =
          findAchievementFileInExecutableDirectory(game);

        achievementFiles.push(...achievementFileInsideDirectory);

        return { game, achievementFiles };
      })
    );
  }

  public static async preSearchAchievements() {
    await setTimeout(4000);

    try {
      const gameAchievementFiles =
        process.platform === "win32"
          ? await this.getGameAchievementFilesWindows()
          : await this.getGameAchievementFilesLinux();

      const newAchievementsCount: number[] = [];

      for (const { game, achievementFiles } of gameAchievementFiles) {
        const result = await this.preProcessGameAchievementFiles(
          game,
          achievementFiles
        );

        newAchievementsCount.push(result);
      }

      const totalNewGamesWithAchievements = newAchievementsCount.filter(
        (achievements) => achievements
      ).length;

      const totalNewAchievements = newAchievementsCount.reduce(
        (acc, val) => acc + val,
        0
      );

      if (totalNewAchievements > 0) {
        const userPreferences = await db.get<string, UserPreferences>(
          levelKeys.userPreferences,
          {
            valueEncoding: "json",
          }
        );

        if (userPreferences.achievementNotificationsEnabled !== false) {
          if (userPreferences.achievementCustomNotificationsEnabled !== false) {
            WindowManager.notificationWindow?.webContents.send(
              "on-combined-achievements-unlocked",
              totalNewGamesWithAchievements,
              totalNewAchievements,
              userPreferences.achievementCustomNotificationPosition ??
                "top-left"
            );
          } else {
            publishCombinedNewAchievementNotification(
              totalNewAchievements,
              totalNewGamesWithAchievements
            );
          }
        }
      }
    } catch (err) {
      achievementsLogger.error("Error on preSearchAchievements", err);
    }

    this._hasFinishedPreSearch = true;
  }
}
