import { gameAchievementRepository, gameRepository } from "@main/repository";
import { steamFindGameAchievementFiles } from "../steam/steam-find-game-achivement-files";
import { steamGlobalAchievementPercentages } from "../steam/steam-global-achievement-percentages";
import { steamAchievementInfo } from "../steam/steam-achievement-info";
import { steamAchievementMerge } from "../steam/steam-achievement-merge";
import { parseAchievementFile } from "../util/parseAchievementFile";
import { checkUnlockedAchievements } from "../util/check-unlocked-achievements";
import { CheckedAchievements } from "../types";

export const saveAllLocalSteamAchivements = async () => {
  const gameAchievementFiles = steamFindGameAchievementFiles();

  for (const key of Object.keys(gameAchievementFiles)) {
    const objectId = key;

    const game = await gameRepository.findOne({
      where: { objectID: objectId },
    });

    if (!game) continue;

    const hasOnDb = await gameAchievementRepository.existsBy({
      game: game,
    });

    if (hasOnDb) continue;

    const achievementPercentage =
      await steamGlobalAchievementPercentages(objectId);

    if (!achievementPercentage) {
      await gameAchievementRepository.save({
        game,
        achievements: "[]",
      });
      continue;
    }

    const achievementInfo = await steamAchievementInfo(objectId);

    if (!achievementInfo) continue;

    const achievements = steamAchievementMerge(
      achievementPercentage,
      achievementInfo
    );

    if (!achievements) continue;

    const checkedAchievements: CheckedAchievements = {
      all: achievements,
      new: [],
    };

    for (const achievementFile of gameAchievementFiles[key]) {
      const localAchievementFile = await parseAchievementFile(
        achievementFile.filePath
      );

      checkedAchievements.new.push(
        ...checkUnlockedAchievements(
          achievementFile.type,
          localAchievementFile,
          achievements
        ).new
      );
    }

    await gameAchievementRepository.save({
      game,
      achievements: JSON.stringify(checkedAchievements.all),
    });
  }
};
