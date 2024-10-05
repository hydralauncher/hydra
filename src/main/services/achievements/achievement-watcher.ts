import { gameRepository } from "@main/repository";
import { checkAchievementFileChange as searchForAchievements } from "./achievement-file-observer";

export const watchAchievements = async () => {
  const games = await gameRepository.find({
    where: {
      isDeleted: false,
    },
  });

  if (games.length === 0) return;

  await searchForAchievements(games);
};
