import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gameAchievementsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
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

            let unlockedAchievementCount = game.unlockedAchievementCount ?? 0;

            if (!game.unlockedAchievementCount) {
              const achievements = await gameAchievementsSublevel.get(key);

              unlockedAchievementCount =
                achievements?.unlockedAchievements.length ?? 0;
            }

            return {
              id: key,
              ...game,
              download: download ?? null,
              unlockedAchievementCount,
              achievementCount: game.achievementCount ?? 0,
              // Spread gameAssets last to ensure all image URLs are properly set
              ...gameAssets,
              // Preserve custom image URLs from game if they exist
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
            };
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
