import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import type { GameShop, LocalGameSnapshotContext } from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getCloudSaveCustomPathRules } from "./custom-path-store";
import {
  buildEmulatorLocalGameSnapshot,
  getEmulatorCloudSavePlatform,
} from "./emulator-cloud-save";

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>
): Promise<LocalGameSnapshotContext> => {
  const context =
    suppliedContext ?? (await getCloudSaveGameContext(objectId, shop));
  const { game, pathContext, environmentId } = context;
  if (game && getEmulatorCloudSavePlatform(game, shop)) {
    return buildEmulatorLocalGameSnapshot(game, environmentId, pathContext);
  }
  const cacheKey = levelKeys.game(shop, objectId);
  const [hashCache, extraRules] = await Promise.all([
    cloudSaveLocalHashCacheSublevel.get(cacheKey).then((value) => value ?? []),
    getCloudSaveCustomPathRules(shop, objectId),
  ]);
  const { hashCache: updatedHashCache, ...snapshot } =
    await NativeAddon.buildLocalGameSnapshotPipeline({
      ...pathContext,
      environmentId,
      title: game?.title,
      remoteId: game?.remoteId ?? undefined,
      userDataPath: SystemPath.getPath("userData"),
      hashCache,
      extraRules,
    });

  if (updatedHashCache.length === 0) {
    await cloudSaveLocalHashCacheSublevel.del(cacheKey);
  } else {
    await cloudSaveLocalHashCacheSublevel.put(cacheKey, updatedHashCache);
  }

  return { ...snapshot, environmentId, pathContext };
};
