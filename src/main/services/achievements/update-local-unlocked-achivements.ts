import { gameAchievementRepository, gameRepository } from "@main/repository";
import {
  findAllAchievementFiles,
  findAchievementFiles,
} from "./find-achivement-files";
import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import type { UnlockedAchievement } from "@types";
import { getGameAchievementData } from "./get-game-achievement-data";

export const updateAllLocalUnlockedAchievements = async () => {
  const gameAchievementFilesMap = findAllAchievementFiles();

  for (const objectId of gameAchievementFilesMap.keys()) {
    const gameAchievementFiles = gameAchievementFilesMap.get(objectId)!;

    const [game, localAchievements] = await Promise.all([
      gameRepository.findOne({
        where: { objectID: objectId, shop: "steam", isDeleted: false },
      }),
      gameAchievementRepository.findOne({
        where: { objectId, shop: "steam" },
      }),
    ]);

    if (!game) continue;

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
      const parsedAchievements = await parseAchievementFile(
        achievementFile.filePath,
        achievementFile.type
      );
      console.log("Parsed for", game.title, parsedAchievements);
      if (parsedAchievements.length) {
        unlockedAchievements.push(...parsedAchievements);
      }
    }

    mergeAchievements(objectId, "steam", unlockedAchievements, false);
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

  const gameAchievementFiles = findAchievementFiles(game);

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
