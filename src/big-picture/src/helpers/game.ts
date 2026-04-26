import type { GameShop, LibraryGame } from "@types";
import { IS_DESKTOP } from "../constants";

export interface GameAchievementProgress {
  label?: string;
  value?: number;
}

export function getGameAchievementProgress(
  game: Pick<LibraryGame, "achievementCount" | "unlockedAchievementCount">
): GameAchievementProgress {
  const achievementCount = game.achievementCount ?? 0;

  if (achievementCount <= 0) {
    return {};
  }

  const unlockedAchievementCount = game.unlockedAchievementCount ?? 0;

  return {
    label: `${unlockedAchievementCount}/${achievementCount}`,
    value: unlockedAchievementCount / achievementCount,
  };
}

export function getBigPictureGameDetailsPath(
  game: Pick<LibraryGame, "shop" | "objectId"> & {
    title?: string | null;
    shop: GameShop;
  }
) {
  const basePath = IS_DESKTOP ? "/big-picture" : "";
  const searchParams = new URLSearchParams();

  if (game.title) {
    searchParams.set("title", game.title);
  }

  const query = searchParams.toString();

  return `${basePath}/game/${game.shop}/${game.objectId}${query ? `?${query}` : ""}`;
}
