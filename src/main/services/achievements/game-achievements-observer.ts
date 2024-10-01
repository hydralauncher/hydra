import { watch } from "node:fs/promises";
import { checkUnlockedAchievements } from "./check-unlocked-achievements";
import { parseAchievementFile } from "./parse-achievement-file";
import { Game } from "@main/entity";
import { mergeAchievements } from "./merge-achievements";
import fs from "node:fs";
import { findSteamGameAchievementFiles } from "./find-steam-game-achivement-files";
import type { AchievementFile } from "@types";
import { logger } from "../logger";

type GameAchievementObserver = {
  [id: number]: AbortController;
};

const gameAchievementObserver: GameAchievementObserver = {};

const processAchievementFile = async (game: Game, file: AchievementFile) => {
  const localAchievementFile = await parseAchievementFile(file.filePath);

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

const startFileWatch = async (game: Game, file: AchievementFile) => {
  const signal = gameAchievementObserver[game.id]?.signal;

  try {
    await processAchievementFile(game, file);

    const watcher = watch(file.filePath, {
      signal,
    });

    for await (const event of watcher) {
      if (event.eventType === "change") {
        logger.log("Detected change in file", file.filePath);
        await processAchievementFile(game, file);
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    logger.error("Failed to watch file", file.filePath, err);
  }
};

export const startGameAchievementObserver = async (game: Game) => {
  if (game.shop !== "steam") return;
  if (gameAchievementObserver[game.id]) return;

  const achievementFiles =
    findSteamGameAchievementFiles(game.objectID).get(game.objectID) || [];

  logger.log(
    "Achievements files to observe for:",
    game.title,
    achievementFiles
  );

  for (const file of achievementFiles) {
    if (!fs.existsSync(file.filePath)) {
      continue;
    }

    if (!gameAchievementObserver[game.id]) {
      const abortController = new AbortController();
      gameAchievementObserver[game.id] = abortController;
    }

    startFileWatch(game, file);
  }
};

export const stopGameAchievementObserver = (gameId: number) => {
  gameAchievementObserver[gameId]?.abort();
  delete gameAchievementObserver[gameId];
};
