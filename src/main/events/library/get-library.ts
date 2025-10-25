import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  gameAchievementsSublevel,
} from "@main/level";

const getLibrary = async (): Promise<LibraryGame[]> => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) => game.isDeleted === false)
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key);
            const gameAssets = await gamesShopAssetsSublevel.get(key);

            let unlockedAchievementCount = 0;
            let achievementCount = 0;

            try {
              const achievements = await gameAchievementsSublevel.get(key);
              if (achievements) {
                achievementCount = achievements.achievements.length;
                unlockedAchievementCount =
                  achievements.unlockedAchievements.length;
              }
            } catch {
              // No achievements data for this game
            }

            return {
              id: key,
              ...game,
              download: download ?? null,
              unlockedAchievementCount,
              achievementCount,
              // Spread gameAssets last to ensure all image URLs are properly set
              ...gameAssets,
              // Preserve custom image URLs from game if they exist
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
            } as LibraryGame;
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
