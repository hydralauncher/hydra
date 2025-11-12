import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setLibrary } from "@renderer/features";

export function useLibrary() {
  const dispatch = useAppDispatch();
  const library = useAppSelector((state) => state.library.value);

  const updateLibrary = useCallback(async () => {
    return window.electron.getLibrary().then(async (updatedLibrary) => {
      const libraryWithAchievements = await Promise.all(
        updatedLibrary.map(async (game) => {
          const unlockedAchievements =
            await window.electron.getUnlockedAchievements(
              game.objectId,
              game.shop
            );

          return {
            ...game,
            unlockedAchievementCount:
              game.unlockedAchievementCount || unlockedAchievements.length,
          };
        })
      );

      dispatch(setLibrary(libraryWithAchievements));
    });
  }, [dispatch]);

  return { library, updateLibrary };
}
