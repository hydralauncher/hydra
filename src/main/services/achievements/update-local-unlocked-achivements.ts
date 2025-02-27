import {
  findAchievementFiles,
  findAchievementFileInExecutableDirectory,
} from "./find-achivement-files";
import { parseAchievementFile } from "./parse-achievement-file";
import { mergeAchievements } from "./merge-achievements";
import type { Game, UnlockedAchievement } from "@types";

export const updateLocalUnlockedAchievements = async (game: Game) => {
  const gameAchievementFiles = findAchievementFiles(game);

  const achievementFileInsideDirectory =
    findAchievementFileInExecutableDirectory(game);

  gameAchievementFiles.push(...achievementFileInsideDirectory);

  const unlockedAchievements: UnlockedAchievement[] = [];

  for (const achievementFile of gameAchievementFiles) {
    const localAchievementFile = parseAchievementFile(
      achievementFile.filePath,
      achievementFile.type
    );

    if (localAchievementFile.length) {
      unlockedAchievements.push(...localAchievementFile);
    }
  }

  mergeAchievements(game, unlockedAchievements, false);
};
