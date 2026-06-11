import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { createGame } from "@main/services/library-sync";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";

const lookupCachedPlatform = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const prefix = `${shop}:${objectId}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.platform
      ) {
        return value.platform;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const addGameToLibrary = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  title: string,
  platform?: string | null
) => {
  const gameKey = levelKeys.game(shop, objectId);
  let game = await gamesSublevel.get(gameKey);

  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  const resolvedPlatform =
    platform ??
    (shop === "launchbox" ? await lookupCachedPlatform(shop, objectId) : null);

  if (game) {
    await downloadsSublevel.del(gameKey);

    game.isDeleted = false;
    game.addedToLibraryAt ??= new Date();
    if (resolvedPlatform && !game.platform) game.platform = resolvedPlatform;

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
      addedToLibraryAt: new Date(),
      platform: resolvedPlatform ?? null,
    };

    await gamesSublevel.put(gameKey, game);
  }

  if (game) {
    await createGame(game).catch(() => {});

    AchievementWatcherManager.firstSyncWithRemoteIfNeeded(
      game.shop,
      game.objectId
    );
  }
};

registerEvent("addGameToLibrary", addGameToLibrary);
