import { checkUnlockedAchievements } from "./check-unlocked-achievements";
import { parseAchievementFile } from "./parse-achievement-file";
import { Game } from "@main/entity";
import { mergeAchievements } from "./merge-achievements";
import fs from "node:fs";
import {
  findAchievementFileInExecutableDirectory,
  findAllSteamGameAchievementFiles,
} from "./find-steam-game-achivement-files";
import type { AchievementFile } from "@types";
import { logger } from "../logger";

const fileStats: Map<string, number> = new Map();

const processAchievementFile = async (game: Game, file: AchievementFile) => {
  const localAchievementFile = await parseAchievementFile(
    file.filePath,
    file.type
  );

  logger.log("Parsed achievements file", file.filePath, localAchievementFile);
  if (localAchievementFile) {
    const unlockedAchievements = checkUnlockedAchievements(
      file.type,
      localAchievementFile
    );
    logger.log("Achievements from file", file.filePath, unlockedAchievements);

    if (unlockedAchievements.length) {
      return mergeAchievements(
        game.objectID,
        game.shop,
        unlockedAchievements,
        true
      );
    }
  }
};

const compareFile = async (game: Game, file: AchievementFile) => {
  try {
    const stat = fs.statSync(file.filePath);
    const currentFileStat = fileStats.get(file.filePath);
    fileStats.set(file.filePath, stat.mtimeMs);

    if (!currentFileStat || currentFileStat === stat.mtimeMs) {
      return;
    }

    logger.log(
      "Detected change in file",
      file.filePath,
      stat.mtimeMs,
      fileStats.get(file.filePath)
    );
    await processAchievementFile(game, file);
  } catch (err) {}
};

export const startGameAchievementObserver = async (games: Game[]) => {
  const achievementFiles = findAllSteamGameAchievementFiles();

  for (const game of games) {
    const gameAchievementFiles = achievementFiles.get(game.objectID) || [];
    const achievementFileInsideDirectory =
      findAchievementFileInExecutableDirectory(game);

    if (achievementFileInsideDirectory) {
      gameAchievementFiles.push(achievementFileInsideDirectory);
    }

    if (!gameAchievementFiles.length) continue;

    logger.log(
      "Achievements files to observe for:",
      game.title,
      gameAchievementFiles
    );

    for (const file of gameAchievementFiles) {
      compareFile(game, file);
    }
  }
};
