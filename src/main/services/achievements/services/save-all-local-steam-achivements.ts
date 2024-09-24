import { gameAchievementRepository, gameRepository } from "@main/repository";
import { steamFindGameAchievementFiles } from "../steam/steam-find-game-achivement-files";
import { parseAchievementFile } from "../util/parseAchievementFile";
import { HydraApi } from "@main/services";

export const saveAllLocalSteamAchivements = async () => {
  const gameAchievementFiles = steamFindGameAchievementFiles();

  for (const key of Object.keys(gameAchievementFiles)) {
    const objectId = key;

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
      HydraApi.get(
        "/games/achievements",
        {
          shop: "steam",
          objectId,
        },
        { needsAuth: false }
      )
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
        .catch(console.log);
    }

    const unlockedAchievements: { name: string; unlockTime: number }[] = [];

    for (const achievementFile of gameAchievementFiles[key]) {
      const localAchievementFile = await parseAchievementFile(
        achievementFile.filePath
      );

      console.log(achievementFile.filePath);

      for (const a of Object.keys(localAchievementFile)) {
        // TODO: use checkUnlockedAchievements after refactoring it to be generic
        unlockedAchievements.push({
          name: a,
          unlockTime: localAchievementFile[a].UnlockTime,
        });
      }
    }

    gameAchievementRepository.upsert(
      {
        objectId,
        shop: "steam",
        unlockedAchievements: JSON.stringify(unlockedAchievements),
      },
      ["objectId", "shop"]
    );
  }
};
