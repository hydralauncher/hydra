import { gameAchievementRepository, gameRepository } from "@main/repository";
import { steamFindGameAchievementFiles } from "../steam/steam-find-game-achivement-files";
import { parseAchievementFile } from "../util/parseAchievementFile";
import { HydraApi } from "@main/services";

export const saveAllLocalSteamAchivements = async () => {
  const gameAchievementFiles = steamFindGameAchievementFiles();

  for (const key of Object.keys(gameAchievementFiles)) {
    const objectId = key;

    const game = await gameRepository.findOne({
      where: { objectID: objectId },
    });

    if (!game) continue;

    const savedGameAchievements = await gameAchievementRepository.findOneBy({
      game: game,
    });

    if (!savedGameAchievements || !savedGameAchievements.achievements) {
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
              game: { id: game.id },
              achievements: JSON.stringify(achievements),
            },
            ["game"]
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
      console.log(localAchievementFile);

      for (const a of Object.keys(localAchievementFile)) {
        // TODO: use checkUnlockedAchievements after refactoring it to be generic
        unlockedAchievements.push({
          name: a,
          unlockTime: localAchievementFile[a].UnlockTime,
        });
      }
    }

    await gameAchievementRepository.upsert(
      {
        game: { id: game.id },
        unlockedAchievements: JSON.stringify(unlockedAchievements),
      },
      ["game"]
    );
  }
};
