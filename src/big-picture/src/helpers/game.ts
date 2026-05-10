import type { GameShop } from "@types";
import { IS_DESKTOP } from "../constants";

export interface GameAchievementProgress {
  label?: string;
  value?: number;
}

export interface GameAchievementProgressSource {
  achievementCount?: number | null;
  unlockedAchievementCount?: number | null;
}

export interface GameIdentity {
  shop: GameShop;
  objectId: string;
}

export interface BigPictureGameDetailsPathParams extends GameIdentity {
  title?: string | null;
}

export interface GameIdentityKeyOptions {
  separator?: string;
}

export function getGameAchievementProgress(
  game: GameAchievementProgressSource
): GameAchievementProgress {
  const achievementCount = game.achievementCount ?? 0;

  if (achievementCount <= 0) return {};

  const unlockedAchievementCount = game.unlockedAchievementCount ?? 0;

  return {
    label: `${unlockedAchievementCount}/${achievementCount}`,
    value: unlockedAchievementCount / achievementCount,
  };
}

export function getBigPictureGameDetailsPath(
  game: BigPictureGameDetailsPathParams
) {
  const basePath = IS_DESKTOP ? "/big-picture" : "";
  const searchParams = new URLSearchParams();

  if (game.title) searchParams.set("title", game.title);

  const query = searchParams.toString();
  const querySuffix = query === "" ? "" : `?${query}`;

  return `${basePath}/game/${game.shop}/${game.objectId}${querySuffix}`;
}

export function getGameIdentityKey(
  game: GameIdentity,
  options: GameIdentityKeyOptions = {}
) {
  const { separator = ":" } = options;

  return `${game.shop}${separator}${game.objectId}`;
}
