import { gameRepository } from "@main/repository";
import { parseAchievementFile } from "./parse-achievement-file";
import { Game } from "@main/entity";
import { mergeAchievements } from "./merge-achievements";
import fs, { readdirSync } from "node:fs";
import {
  findAchievementFileInExecutableDirectory,
  findAllAchievementFiles,
  getAlternativeObjectIds,
} from "./find-achivement-files";
import type { AchievementFile } from "@types";
import { achievementsLogger, logger } from "../logger";
import { Cracker } from "@shared";

const fileStats: Map<string, number> = new Map();
const fltFiles: Map<string, Set<string>> = new Map();

export const watchAchievements = async () => {
  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  if (games.length === 0) return;

  const achievementFiles = findAllAchievementFiles();

  for (const game of games) {
    for (const objectId of getAlternativeObjectIds(game.objectID)) {
      const gameAchievementFiles = achievementFiles.get(objectId) || [];
      const achievementFileInsideDirectory =
        findAchievementFileInExecutableDirectory(game);

      gameAchievementFiles.push(...achievementFileInsideDirectory);

      if (!gameAchievementFiles.length) continue;

      console.log(
        "Achievements files to observe for:",
        game.title,
        gameAchievementFiles
      );

      for (const file of gameAchievementFiles) {
        compareFile(game, file);
      }
    }
  }
};

const processAchievementFileDiff = async (
  game: Game,
  file: AchievementFile
) => {
  const unlockedAchievements = parseAchievementFile(file.filePath, file.type);

  logger.log("Achievements from file", file.filePath, unlockedAchievements);

  if (unlockedAchievements.length) {
    return mergeAchievements(
      game.objectID,
      game.shop,
      unlockedAchievements,
      true
    );
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

    logger.log("Detected change in FLT folder", file.filePath);
    await processAchievementFileDiff(game, file);
  } catch (err) {
    achievementsLogger.error(err);
    fltFiles.set(file.filePath, new Set());
  }
};

const compareFile = async (game: Game, file: AchievementFile) => {
  if (file.type === Cracker.flt) {
    await compareFltFolder(game, file);
    return;
  }

  try {
    const currentStat = fs.statSync(file.filePath);
    const previousStat = fileStats.get(file.filePath);
    fileStats.set(file.filePath, currentStat.mtimeMs);

    if (!previousStat) {
      if (currentStat.mtimeMs) {
        await processAchievementFileDiff(game, file);
        return;
      }
    }

    if (previousStat === currentStat.mtimeMs) {
      return;
    }

    logger.log(
      "Detected change in file",
      file.filePath,
      currentStat.mtimeMs,
      fileStats.get(file.filePath)
    );
    await processAchievementFileDiff(game, file);
  } catch (err) {
    fileStats.set(file.filePath, -1);
  }
};
