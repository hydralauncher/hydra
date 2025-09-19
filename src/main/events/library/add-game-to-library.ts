import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { createGame } from "@main/services/library-sync";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string
) => {
  const gameKey = levelKeys.game(shop, objectId);
  let game = await gamesSublevel.get(gameKey);

  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  if (game) {
    await downloadsSublevel.del(gameKey);

    game.isDeleted = false;

    await gamesSublevel.put(gameKey, game);
  } else {
    game = {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
    };

    await gamesSublevel.put(gameKey, game);
  }

  await createGame(game).catch(() => {});

  AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
    game.shop,
    game.objectId
  );
};

registerEvent("addGameToLibrary", addGameToLibrary);
