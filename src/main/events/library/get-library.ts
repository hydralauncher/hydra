import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
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

            return {
              id: key,
              ...game,
              download: download ?? null,
              unlockedAchievementCount: game.unlockedAchievementCount ?? 0,
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
