import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import type {
  GameShop,
  LocalGameSnapshotContext,
  StoreUserContext,
} from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { customPathToCloudSaveRule } from "./custom-path-store";

interface BuildLocalGameSnapshotContextOptions {
  scanStoreUserContext?: StoreUserContext;
}

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  options: BuildLocalGameSnapshotContextOptions = {}
): Promise<LocalGameSnapshotContext> => {
  const context =
    suppliedContext ?? (await getCloudSaveGameContext(objectId, shop));
  const { game, pathContext, environmentId } = context;
  const cacheKey = levelKeys.game(shop, objectId);
  const [hashCache, extraRules] = await Promise.all([
    cloudSaveLocalHashCacheSublevel.get(cacheKey).then((value) => value ?? []),
    getUsableCloudSaveCustomPathBindings(objectId, shop, context).then(
      ({ ready }) => ready.map(customPathToCloudSaveRule)
    ),
  ]);
  const { hashCache: updatedHashCache, ...snapshot } =
    await NativeAddon.buildLocalGameSnapshotPipeline({
      ...pathContext,
      storeUserContext:
        options.scanStoreUserContext ?? pathContext.storeUserContext,
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
