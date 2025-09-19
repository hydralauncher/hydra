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

            // 确保返回的对象符合 LibraryGame 类型
            return {
              id: key,
              ...game,
              download: download ?? null,
              // 确保 gameAssets 中的可能为 null 的字段转换为 undefined
              libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? undefined,
              libraryImageUrl: gameAssets?.libraryImageUrl ?? undefined,
              logoImageUrl: gameAssets?.logoImageUrl ?? undefined,
              logoPosition: gameAssets?.logoPosition ?? undefined,
              coverImageUrl: gameAssets?.coverImageUrl ?? undefined,
            };
          })
      );
    });
};

registerEvent("getLibrary", getLibrary);
