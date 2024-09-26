import { gameRepository } from "@main/repository";
import { steamFindGameAchievementFiles } from "./steam/steam-find-game-achivement-files";
import { AchievementFile } from "./types";

export const getGameAchievementsToWatch = async (
  gameId: number
): Promise<AchievementFile[]> => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game || game.shop !== "steam") return [];

  const steamId = Number(game.objectID);

  const achievementFiles = steamFindGameAchievementFiles(game.objectID)[
    steamId
  ];
  console.log(
    "achivements files:",
    achievementFiles,
    game.title,
    game.objectID
  );

  return achievementFiles || [];
};
