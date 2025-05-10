import { ShopAssets } from "@types";
import { HydraApi } from "../hydra-api";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";

type ProfileGame = {
  id: string;
  lastTimePlayed: Date | null;
  playTimeInMilliseconds: number;
} & ShopAssets;

export const mergeWithRemoteGames = async () => {
  return HydraApi.get<ProfileGame[]>("/profile/games")
    .then(async (response) => {
      for (const game of response) {
        const localGame = await gamesSublevel.get(
          levelKeys.game(game.shop, game.objectId)
        );

        if (localGame) {
          const updatedLastTimePlayed =
            localGame.lastTimePlayed == null ||
            (game.lastTimePlayed &&
              new Date(game.lastTimePlayed) > localGame.lastTimePlayed)
              ? game.lastTimePlayed
              : localGame.lastTimePlayed;

          const updatedPlayTime =
            localGame.playTimeInMilliseconds < game.playTimeInMilliseconds
              ? game.playTimeInMilliseconds
              : localGame.playTimeInMilliseconds;

          await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
            ...localGame,
            remoteId: game.id,
            lastTimePlayed: updatedLastTimePlayed,
            playTimeInMilliseconds: updatedPlayTime,
          });
        } else {
          await gamesSublevel.put(levelKeys.game(game.shop, game.objectId), {
            objectId: game.objectId,
            title: game.title,
            remoteId: game.id,
            shop: game.shop,
            iconUrl: game.iconUrl,
            lastTimePlayed: game.lastTimePlayed,
            playTimeInMilliseconds: game.playTimeInMilliseconds,
            isDeleted: false,
          });
        }

        await gamesShopAssetsSublevel.put(
          levelKeys.game(game.shop, game.objectId),
          {
            shop: game.shop,
            objectId: game.objectId,
            title: game.title,
            coverImageUrl: game.coverImageUrl,
            libraryHeroImageUrl: game.libraryHeroImageUrl,
            libraryImageUrl: game.libraryImageUrl,
            logoImageUrl: game.logoImageUrl,
            iconUrl: game.iconUrl,
            logoPosition: game.logoPosition,
          }
        );
      }
    })
    .catch(() => {});
};
