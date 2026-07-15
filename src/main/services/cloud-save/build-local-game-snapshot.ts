import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import type { GameShop, LocalGameSnapshotPipelineResult } from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop
): Promise<LocalGameSnapshotPipelineResult> => {
  const { game, pathContext } = await getCloudSaveGameContext(objectId, shop);
  const cacheKey = levelKeys.game(shop, objectId);
  const hashCache = (await cloudSaveLocalHashCacheSublevel.get(cacheKey)) ?? [];
  const { hashCache: updatedHashCache, ...snapshot } =
    await NativeAddon.buildLocalGameSnapshotPipeline({
      ...pathContext,
      title: game?.title,
      remoteId: game?.remoteId ?? undefined,
      userDataPath: SystemPath.getPath("userData"),
      hashCache,
    });

  if (updatedHashCache.length === 0) {
    await cloudSaveLocalHashCacheSublevel.del(cacheKey);
  } else {
    await cloudSaveLocalHashCacheSublevel.put(cacheKey, updatedHashCache);
  }

  return snapshot;
};
