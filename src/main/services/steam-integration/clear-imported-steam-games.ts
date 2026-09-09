import type { Game } from "@types";
import {
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
} from "@main/level";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { steamSyncLogger } from "../logger";
import { shouldRemoveImportedSteamGame } from "./steam-imported-games";

const markGameDeleted = async (game: Game, gameKey: string) => {
  await gamesSublevel.put(gameKey, {
    ...updateGameExecutablePath(game, null),
    isDeleted: true,
    customIconUrl: null,
    customLogoImageUrl: null,
    customHeroImageUrl: null,
    customCoverImageUrl: null,
  });

  const existingAssets = await gamesShopAssetsSublevel.get(gameKey);
  if (existingAssets) {
    await gamesShopAssetsSublevel.put(gameKey, {
      ...existingAssets,
      title: existingAssets.title,
    });
  }

  await gamesArtworkSelectionSublevel.del(gameKey).catch(() => {});
};

export const clearImportedSteamGames = async (steamOnlyObjectIds: string[]) => {
  const ids = new Set(steamOnlyObjectIds);
  let removed = 0;

  for (const [key, game] of await gamesSublevel.iterator().all()) {
    if (!shouldRemoveImportedSteamGame(game, ids)) continue;

    await markGameDeleted(game, key);
    removed += 1;
  }

  steamSyncLogger.log(
    "Cleared imported Steam games",
    removed,
    "of",
    ids.size,
    "remote steam-only ids"
  );

  return removed;
};
