import { gameRepository } from "@main/repository";
import { startGameAchievementObserver } from "./game-achievements-observer";

export const watchAchievements = async () => {
  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  if (games.length === 0) return;

  for (const game of games) {
    startGameAchievementObserver(game);
  }
};
