import { ShopAssets } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";

type ProfileGame = {
  id: string;
  lastTimePlayed: Date | null;
  playTimeInMilliseconds: number;
  hasManuallyUpdatedPlaytime: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
} & ShopAssets;

export const mergeWithRemoteGames = async () => {
  return HydraApi.get<ProfileGame[]>("/profile/games")
    .then(async (response) => {
      for (const game of response) {
        const gameKey = levelKeys.game(game.shop, game.objectId);
        const localGame = await gamesSublevel.get(gameKey);

        if (localGame) {
          const updatedLastTimePlayed =
            localGame.lastTimePlayed == null ||
            (game.lastTimePlayed &&
              new Date(game.lastTimePlayed) >
                new Date(localGame.lastTimePlayed))
              ? game.lastTimePlayed
              : localGame.lastTimePlayed;

          const updatedPlayTime =
            localGame.playTimeInMilliseconds < game.playTimeInMilliseconds
              ? game.playTimeInMilliseconds
              : localGame.playTimeInMilliseconds;

          await gamesSublevel.put(gameKey, {
            ...localGame,
            remoteId: game.id,
            lastTimePlayed: updatedLastTimePlayed,
            playTimeInMilliseconds: updatedPlayTime,
            favorite: game.isFavorite ?? localGame.favorite,
            isPinned: game.isPinned ?? localGame.isPinned,
          });
        } else {
          await gamesSublevel.put(gameKey, {
            objectId: game.objectId,
            title: game.title,
            remoteId: game.id,
            shop: game.shop,
            iconUrl: game.iconUrl,
            libraryHeroImageUrl: game.libraryHeroImageUrl,
            logoImageUrl: game.logoImageUrl,
            lastTimePlayed: game.lastTimePlayed,
            playTimeInMilliseconds: game.playTimeInMilliseconds,
            hasManuallyUpdatedPlaytime: game.hasManuallyUpdatedPlaytime,
            isDeleted: false,
            favorite: game.isFavorite ?? false,
            isPinned: game.isPinned ?? false,
          });
        }

        const localGameShopAsset = await gamesShopAssetsSublevel.get(gameKey);

        await gamesShopAssetsSublevel.put(gameKey, {
          updatedAt: Date.now(),
          ...localGameShopAsset,
          shop: game.shop,
          objectId: game.objectId,
          title: localGame?.title || game.title, // Preserve local title if it exists
          coverImageUrl: game.coverImageUrl,
          libraryHeroImageUrl: game.libraryHeroImageUrl,
          libraryImageUrl: game.libraryImageUrl,
          logoImageUrl: game.logoImageUrl,
          iconUrl: game.iconUrl,
          logoPosition: game.logoPosition,
          downloadSources: game.downloadSources,
        });
      }
    })
    .catch(() => {});
};
