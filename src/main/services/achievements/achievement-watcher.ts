import { gameRepository } from "@main/repository";
import { startGameAchievementObserver as searchForAchievements } from "./game-achievements-observer";

export const watchAchievements = async () => {
  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  if (games.length === 0) return;

  await searchForAchievements(games);
};
