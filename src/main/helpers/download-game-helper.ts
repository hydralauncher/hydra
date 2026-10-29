import { libraryWriteQueue } from "../services/library-sync/library-write-queue";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { DownloadOrchestrator } from "@main/services/download-orchestrator";
import { getDownloadParts } from "@main/services/download/download-parts";
import { assertMultipartHosterDownloadsEnabled } from "@main/services/download/multipart-hoster-feature";
import { type Downloader, MULTIPART_DOWNLOADERS } from "@shared";
import { canDiscardDownload, type GameShop } from "../../types";

interface PrepareGameEntryParams {
  gameKey: string;
  title: string;
  objectId: string;
  shop: GameShop;
}

export const getMultipartDownloadParts = async (
  uri: string,
  parts: unknown,
  downloader: Downloader
): Promise<string[] | undefined> => {
  const downloadParts = getDownloadParts(uri, parts);
  if (!downloadParts) return undefined;
  if (!MULTIPART_DOWNLOADERS.has(downloader)) {
    throw new Error("This downloader does not support multi-part downloads.");
  }
  await assertMultipartHosterDownloadsEnabled();
  return downloadParts;
};

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
    await libraryWriteQueue.run(async () => {
      const latest = await gamesSublevel.get(gameKey);
      if (!latest) return;
      await gamesSublevel.put(gameKey, {
        ...latest,
        isDeleted: false,
        source: "hydra",
        ...(shop === "epic" ? { remoteId: null } : {}),
      });
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
