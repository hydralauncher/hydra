import { gameAchievementRepository, gameRepository } from "@main/repository";
import {
  findAllAchievementFiles,
  findAchievementFiles,
  findAchievementFileInExecutableDirectory,
  getAlternativeObjectIds,
} from "./find-achivement-files";
import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import type { AchievementFile, UnlockedAchievement } from "@types";
import { getGameAchievementData } from "./get-game-achievement-data";
import { achievementsLogger } from "../logger";
import { Game } from "@main/entity";

export const updateAllLocalUnlockedAchievements = async () => {
  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  if (games.length === 0) return;

  const gameAchievementFilesMap = findAllAchievementFiles();

  for (const game of games) {
    gameAchievementRepository
      .findOne({
        where: { objectId: game.objectID, shop: "steam" },
      })
      .then((localAchievements) => {
        if (!localAchievements || !localAchievements.achievements) {
          getGameAchievementData(game.objectID, "steam");
        }
      });

    const gameAchievementFiles: AchievementFile[] = [];
    const unlockedAchievements: UnlockedAchievement[] = [];

    for (const objectId of getAlternativeObjectIds(game.objectID)) {
      gameAchievementFiles.push(
        ...(gameAchievementFilesMap.get(objectId) || [])
      );

      gameAchievementFiles.push(
        ...findAchievementFileInExecutableDirectory(game)
      );
    }

    for (const achievementFile of gameAchievementFiles) {
      const parsedAchievements = parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );

      if (parsedAchievements.length) {
        unlockedAchievements.push(...parsedAchievements);

        achievementsLogger.log(
          "Achievement file for",
          game.title,
          achievementFile.filePath,
          parsedAchievements
        );
      }

      await mergeAchievements(
        game.objectID,
        "steam",
        unlockedAchievements,
        false
      );
    }
  }
};

export const updateLocalUnlockedAchivements = async (game: Game) => {
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

  mergeAchievements(game.objectID, "steam", unlockedAchievements, false);
};
