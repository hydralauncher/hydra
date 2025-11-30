import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setLibrary } from "@renderer/features";
import { levelDBService } from "@renderer/services/leveldb.service";
import type {
  LibraryGame,
  Game,
  Download,
  ShopAssets,
  GameAchievement,
} from "@types";

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);

  const updateLibrary = useCallback(async () => {
    const results = await levelDBService.iterator("games");

    const libraryGames = await Promise.all(
      results
        .filter(([_key, game]) => (game as Game).isDeleted === false)
        .map(async ([key, game]) => {
          const gameData = game as Game;
          const download = (await levelDBService.get(
            key,
            "downloads"
          )) as Download | null;
          const gameAssets = (await levelDBService.get(
            key,
            "gameShopAssets"
          )) as (ShopAssets & { updatedAt: number }) | null;

          let unlockedAchievementCount = gameData.unlockedAchievementCount ?? 0;

          if (!gameData.unlockedAchievementCount) {
            const achievements = (await levelDBService.get(
              key,
              "gameAchievements"
            )) as GameAchievement | null;

            unlockedAchievementCount =
              achievements?.unlockedAchievements.length ?? 0;
          }

          return {
            id: key,
            ...gameData,
            download: download ?? null,
            unlockedAchievementCount,
            achievementCount: gameData.achievementCount ?? 0,
            // Spread gameAssets last to ensure all image URLs are properly set
            ...gameAssets,
            // Preserve custom image URLs from game if they exist
            customIconUrl: gameData.customIconUrl,
            customLogoImageUrl: gameData.customLogoImageUrl,
            customHeroImageUrl: gameData.customHeroImageUrl,
          } as LibraryGame;
        })
    );

    dispatch(setLibrary(libraryGames));
  }, [dispatch]);

  return { library, updateLibrary };
}
