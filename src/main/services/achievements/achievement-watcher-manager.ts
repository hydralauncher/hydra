import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import fs, { readdirSync } from "node:fs";
import {
  findAchievementFileInExecutableDirectory,
  findAchievementFiles,
  findAllAchievementFiles,
  getAlternativeObjectIds,
} from "./find-achivement-files";
import type { AchievementFile, Game, UnlockedAchievement } from "@types";
import { achievementsLogger } from "../logger";
import { Cracker } from "@shared";
import { publishCombinedNewAchievementNotification } from "../notifications";
import { gamesSublevel } from "@main/level";

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
      gameAchievementFiles.push(...(achievementFiles.get(objectId) || []));

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
    fileStats.set(file.filePath, -1);
    return;
  }
};

const processAchievementFileDiff = async (
  game: Game,
  file: AchievementFile
) => {
  const unlockedAchievements = parseAchievementFile(file.filePath, file.type);

  if (unlockedAchievements.length) {
    return mergeAchievements(game, unlockedAchievements, true);
  }

  return 0;
};

export class AchievementWatcherManager {
  private static hasFinishedMergingWithRemote = false;

  public static watchAchievements = () => {
    if (!this.hasFinishedMergingWithRemote) return;

    if (process.platform === "win32") {
      return watchAchievementsWindows();
    }

    return watchAchievementsWithWine();
  };

  private static preProcessGameAchievementFiles = (
    game: Game,
    gameAchievementFiles: AchievementFile[]
  ) => {
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

    return mergeAchievements(game, unlockedAchievements, false);
  };

  private static preSearchAchievementsWindows = async () => {
    const games = await gamesSublevel
      .values()
      .all()
      .then((games) => games.filter((game) => !game.isDeleted));

    const gameAchievementFilesMap = findAllAchievementFiles();

    return Promise.all(
      games.map((game) => {
        const gameAchievementFiles: AchievementFile[] = [];

        for (const objectId of getAlternativeObjectIds(game.objectId)) {
          gameAchievementFiles.push(
            ...(gameAchievementFilesMap.get(objectId) || [])
          );

          gameAchievementFiles.push(
            ...findAchievementFileInExecutableDirectory(game)
          );
        }

        return this.preProcessGameAchievementFiles(game, gameAchievementFiles);
      })
    );
  };

  private static preSearchAchievementsWithWine = async () => {
    const games = await gamesSublevel
      .values()
      .all()
      .then((games) => games.filter((game) => !game.isDeleted));

    return Promise.all(
      games.map((game) => {
        const gameAchievementFiles = findAchievementFiles(game);
        const achievementFileInsideDirectory =
          findAchievementFileInExecutableDirectory(game);

        gameAchievementFiles.push(...achievementFileInsideDirectory);

        return this.preProcessGameAchievementFiles(game, gameAchievementFiles);
      })
    );
  };

  public static preSearchAchievements = async () => {
    try {
      const newAchievementsCount =
        process.platform === "win32"
          ? await this.preSearchAchievementsWindows()
          : await this.preSearchAchievementsWithWine();

      const totalNewGamesWithAchievements = newAchievementsCount.filter(
        (achievements) => achievements
      ).length;
      const totalNewAchievements = newAchievementsCount.reduce(
        (acc, val) => acc + val,
        0
      );

      if (totalNewAchievements > 0) {
        publishCombinedNewAchievementNotification(
          totalNewAchievements,
          totalNewGamesWithAchievements
        );
      }
    } catch (err) {
      achievementsLogger.error("Error on preSearchAchievements", err);
    }

    this.hasFinishedMergingWithRemote = true;
  };
}
