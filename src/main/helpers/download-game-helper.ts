import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { DownloadOrchestrator } from "@main/services/download-orchestrator";
import { canDiscardDownload, type GameShop } from "../../types";

interface PrepareGameEntryParams {
  gameKey: string;
  title: string;
  objectId: string;
  shop: GameShop;
}

export const clearFinishedDownload = async (
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const gameKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(gameKey);

  if (!download || !canDiscardDownload(download)) return;

  await downloadsSublevel.del(gameKey).catch(() => {});
  await DownloadOrchestrator.syncAfterDownloadRemoved({ shop, objectId }).catch(
    () => {}
  );
};

export const prepareGameEntry = async ({
  gameKey,
  title,
  objectId,
  shop,
}: PrepareGameEntryParams): Promise<void> => {
  const game = await gamesSublevel.get(gameKey);
  const gameAssets = await gamesShopAssetsSublevel.get(gameKey);

  await downloadsSublevel.del(gameKey);

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      isDeleted: false,
    });
  } else {
    await gamesSublevel.put(gameKey, {
      title,
      iconUrl: gameAssets?.iconUrl ?? null,
      libraryHeroImageUrl: gameAssets?.libraryHeroImageUrl ?? null,
      logoImageUrl: gameAssets?.logoImageUrl ?? null,
      objectId,
      shop,
      remoteId: null,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      isDeleted: false,
    });
  }
};
