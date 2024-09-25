import { gameRepository, gameAchievementRepository } from "@main/repository";
import { steamGetAchivement } from "./steam/steam-get-achivement";
import { steamFindGameAchievementFiles } from "./steam/steam-find-game-achivement-files";
import { AchievementFile, CheckedAchievements } from "./types";
import { parseAchievementFile } from "./util/parseAchievementFile";
import { checkUnlockedAchievements } from "./util/check-unlocked-achievements";

export const getGameAchievementsToWatch = async (
  gameId: number
): Promise<
  | {
      steamId: number;
      checkedAchievements: CheckedAchievements;
      achievementFiles: AchievementFile[];
    }
  | undefined
> => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game || game.shop !== "steam") return;

  const steamId = Number(game.objectID);

  const achievements = await steamGetAchivement(game);

  console.log(achievements);

  if (!achievements || !achievements.length) return;

  const achievementFiles = steamFindGameAchievementFiles(game.objectID)[
    steamId
  ];
  console.log(achievementFiles);
  if (!achievementFiles || !achievementFiles.length) return;

  const checkedAchievements: CheckedAchievements = {
    all: achievements,
    new: [],
  };

  for (const achievementFile of achievementFiles) {
    const file = await parseAchievementFile(achievementFile.filePath);

    checkedAchievements.new.push(
      ...checkUnlockedAchievements(achievementFile.type, file, achievements).new
    );
  }

  if (checkedAchievements.new.length) {
    await gameAchievementRepository.update(
      {
        game: { id: gameId },
      },
      {
        unlockedAchievements: JSON.stringify(checkedAchievements.all),
      }
    );
  }

  return { steamId, checkedAchievements, achievementFiles };
};
