import { gameAchievementRepository } from "@main/repository";
import { steamGlobalAchievementPercentages } from "./steam-global-achievement-percentages";
import { steamAchievementInfo } from "./steam-achievement-info";
import { steamAchievementMerge } from "./steam-achievement-merge";
import { Achievement } from "../types";
import { Game } from "@main/entity";

export const steamGetAchivement = async (
  game: Game
): Promise<Achievement[] | undefined> => {
  const gameAchivement = await gameAchievementRepository.findOne({
    where: { game: game },
  });

  if (!gameAchivement) {
    const achievementPercentage = await steamGlobalAchievementPercentages(
      game.objectID
    );
    console.log(achievementPercentage);
    if (!achievementPercentage) {
      await gameAchievementRepository.save({
        game,
        achievements: "[]",
      });
      return [];
    }

    const achievementInfo = await steamAchievementInfo(game.objectID);
    console.log(achievementInfo);
    if (!achievementInfo) return;

    const achievements = steamAchievementMerge(
      achievementPercentage,
      achievementInfo
    );

    if (!achievements) return;

    await gameAchievementRepository.save({
      game,
      achievements: JSON.stringify(achievements),
    });

    return achievements;
  } else {
    return JSON.parse(gameAchivement.achievements);
  }
};
