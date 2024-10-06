import { gameAchievementRepository, gameRepository } from "@main/repository";
import {
  findAllAchievementFiles,
  findAchievementFiles,
  findAchievementFileInExecutableDirectory,
  getAlternativeObjectIds,
} from "./find-achivement-files";
import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import type { UnlockedAchievement } from "@types";
import { getGameAchievementData } from "./get-game-achievement-data";
import { achievementsLogger } from "../logger";

export const updateAllLocalUnlockedAchievements = async () => {
  const gameAchievementFilesMap = findAllAchievementFiles();

  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  for (const game of games) {
    for (const objectId of getAlternativeObjectIds(game.objectID)) {
      const gameAchievementFiles = gameAchievementFilesMap.get(objectId) || [];
      const achievementFileInsideDirectory =
        findAchievementFileInExecutableDirectory(game);

      gameAchievementFiles.push(...achievementFileInsideDirectory);

      const localAchievements = await gameAchievementRepository.findOne({
        where: { objectId: game.objectID, shop: "steam" },
      });

      if (!localAchievements || !localAchievements.achievements) {
        await getGameAchievementData(game.objectID, "steam")
          .then((achievements) => {
            return gameAchievementRepository.upsert(
              {
                objectId: game.objectID,
                shop: "steam",
                achievements: JSON.stringify(achievements),
              },
              ["objectId", "shop"]
            );
          })
          .catch(() => {});
      }

      const unlockedAchievements: UnlockedAchievement[] = [];

      for (const achievementFile of gameAchievementFiles) {
        const parsedAchievements = await parseAchievementFile(
          achievementFile.filePath,
          achievementFile.type
        );

        if (parsedAchievements.length) {
          unlockedAchievements.push(...parsedAchievements);
        }

        achievementsLogger.log(
          "Achievement file for",
          game.title,
          achievementFile.filePath,
          parsedAchievements
        );
      }

      mergeAchievements(game.objectID, "steam", unlockedAchievements, false);
    }
  }
};

export const updateLocalUnlockedAchivements = async (objectId: string) => {
  const [game, localAchievements] = await Promise.all([
    gameRepository.findOne({
      where: { objectID: objectId, shop: "steam", isDeleted: false },
    }),
    gameAchievementRepository.findOne({
      where: { objectId, shop: "steam" },
    }),
  ]);

  if (!game) return;

  const gameAchievementFiles = await findAchievementFiles(game);

  const achievementFileInsideDirectory =
    findAchievementFileInExecutableDirectory(game);

  gameAchievementFiles.push(...achievementFileInsideDirectory);

  console.log("Achievements files for", game.title, gameAchievementFiles);

  if (!localAchievements || !localAchievements.achievements) {
    await getGameAchievementData(objectId, "steam")
      .then((achievements) => {
        return gameAchievementRepository.upsert(
          {
            objectId,
            shop: "steam",
            achievements: JSON.stringify(achievements),
          },
          ["objectId", "shop"]
        );
      })
      .catch(() => {});
  }

  const unlockedAchievements: UnlockedAchievement[] = [];

  for (const achievementFile of gameAchievementFiles) {
    const localAchievementFile = await parseAchievementFile(
      achievementFile.filePath,
      achievementFile.type
    );

    if (localAchievementFile.length) {
      unlockedAchievements.push(...localAchievementFile);
    }
  }

  mergeAchievements(objectId, "steam", unlockedAchievements, false);
};
