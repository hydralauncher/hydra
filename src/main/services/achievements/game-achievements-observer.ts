import { watch } from "node:fs/promises";
import { getGameAchievementsToWatch } from "./get-game-achievements-to-watch";
import { checkUnlockedAchievements } from "./util/check-unlocked-achievements";
import { parseAchievementFile } from "./util/parseAchievementFile";
import { Game } from "@main/entity";
import { mergeAchievements } from "./merge-achievements";
import fs from "node:fs";
import { AchievementFile } from "./types";

type GameAchievementObserver = {
  [id: number]: AbortController;
};

const gameAchievementObserver: GameAchievementObserver = {};

const processAchievementFile = async (game: Game, file: AchievementFile) => {
  const localAchievementFile = await parseAchievementFile(file.filePath);
  console.log(localAchievementFile);

  if (localAchievementFile) {
    const unlockedAchievements = checkUnlockedAchievements(
      file.type,
      localAchievementFile
    );
    console.log(unlockedAchievements);

    if (unlockedAchievements.length) {
      mergeAchievements(game.objectID, game.shop, unlockedAchievements);
    }
  }
};

export const startGameAchievementObserver = async (game: Game) => {
  if (gameAchievementObserver[game.id]) return;

  console.log(`Starting: ${game.title}`);

  const achievementFiles = await getGameAchievementsToWatch(game.id);

  console.log(
    "Achievements files to observe for:",
    game.title,
    achievementFiles
  );

  for (const file of achievementFiles) {
    if (!fs.existsSync(file.filePath)) {
      continue;
    }

    console.log(`cracker: ${file.type}, objectId: ${game.objectID}`);

    if (!gameAchievementObserver[game.id]) {
      const abortController = new AbortController();
      gameAchievementObserver[game.id] = abortController;
    }

    const signal = gameAchievementObserver[game.id]?.signal;

    (async () => {
      try {
        processAchievementFile(game, file);

        const watcher = watch(file.filePath, {
          signal,
        });

        for await (const event of watcher) {
          if (event.eventType === "change") {
            processAchievementFile(game, file);
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        console.log(`cracker: ${file.type}, steamId ${game.objectID}`);
        throw err;
      }
    })();
  }
};

export const stopGameAchievementObserver = (gameId: number) => {
  console.log(`Stopping: ${gameId}`);
  gameAchievementObserver[gameId]?.abort();
  delete gameAchievementObserver[gameId];
};
