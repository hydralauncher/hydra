import { gameAchievementRepository, gameRepository } from "@main/repository";
import {
  findAllSteamGameAchievementFiles,
  findSteamGameAchievementFiles,
} from "./find-steam-game-achivement-files";
import { parseAchievementFile } from "./parse-achievement-file";
import { checkUnlockedAchievements } from "./check-unlocked-achievements";
import { mergeAchievements } from "./merge-achievements";
import type { UnlockedAchievement } from "@types";
import { getGameAchievementData } from "./get-game-achievement-data";

export const updateAllLocalUnlockedAchievements = async () => {
  const gameAchievementFilesMap = findAllSteamGameAchievementFiles();

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

      if (localAchievementFile) {
        unlockedAchievements.push(
          ...checkUnlockedAchievements(
            achievementFile.type,
            localAchievementFile
          )
        );
      }
    }

    mergeAchievements(objectId, "steam", unlockedAchievements, false);
  }
};

export const updateLocalUnlockedAchivements = async (
  publishNotification: boolean,
  objectId: string
) => {
  const [game, localAchievements] = await Promise.all([
    gameRepository.findOne({
      where: { objectID: objectId, shop: "steam", isDeleted: false },
    }),
    gameAchievementRepository.findOne({
      where: { objectId, shop: "steam" },
    }),
  ]);

  if (!game) return;

  const gameAchievementFiles = findSteamGameAchievementFiles(game);

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

    if (localAchievementFile) {
      unlockedAchievements.push(
        ...checkUnlockedAchievements(achievementFile.type, localAchievementFile)
      );
    }
  }

  mergeAchievements(
    objectId,
    "steam",
    unlockedAchievements,
    publishNotification
  );
};
