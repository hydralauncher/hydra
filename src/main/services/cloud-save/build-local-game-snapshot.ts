import { SystemPath } from "@main/services/system-path";
import { cloudSaveLocalHashCacheSublevel, levelKeys } from "@main/level";
import { logger } from "@main/services/logger";
import type { GameShop, LocalGameSnapshotBuildResult } from "@types";

import { NativeAddon } from "../native-addon";
import { getCloudSaveGameContext } from "./cloud-save-game-context";

export const buildLocalGameSnapshotContext = async (
  objectId: string,
  shop: GameShop
): Promise<LocalGameSnapshotBuildResult> => {
  const { game, pathContext } = await getCloudSaveGameContext(objectId, shop);
  const cacheKey = levelKeys.game(shop, objectId);
  const hashCache = (await cloudSaveLocalHashCacheSublevel.get(cacheKey)) ?? [];
  const result = await NativeAddon.buildLocalGameSnapshotPipeline({
    ...pathContext,
    title: game?.title,
    remoteId: game?.remoteId ?? undefined,
    userDataPath: SystemPath.getPath("userData"),
    hashCache,
  });
  const { hashCache: updatedHashCache } = result;

  if (updatedHashCache.length === 0) {
    await cloudSaveLocalHashCacheSublevel.del(cacheKey);
  } else {
    await cloudSaveLocalHashCacheSublevel.put(cacheKey, updatedHashCache);
  }

  if (result.status === "local-conflict") {
    if (result.snapshot || result.conflicts.length === 0) {
      throw new Error("Invalid local cloud save conflict result");
    }
    logger.warn("[Cloud Save] Conflicting local copies detected", {
      shop,
      objectId,
      physicalFileCount: result.physicalFileCount,
      conflicts: result.conflicts.map((conflict) => ({
        rawPath: conflict.rawPath,
        relativePath: conflict.relativePath,
        copies: conflict.copies.map((copy) => copy.absolutePath),
      })),
    });
    return {
      status: "local-conflict",
      snapshot: null,
      conflicts: result.conflicts,
    };
  }

  if (!result.snapshot || result.conflicts.length > 0) {
    throw new Error("Invalid ready local cloud save snapshot result");
  }
  if (result.consolidatedCopyCount > 0) {
    logger.info("[Cloud Save] Consolidated identical local copies", {
      shop,
      objectId,
      physicalFileCount: result.physicalFileCount,
      logicalFileCount: result.snapshot.fileCount,
      consolidatedCopyCount: result.consolidatedCopyCount,
    });
  }
  const { hashCache: _nestedHashCache, ...snapshot } = result.snapshot;
  return { status: "ready", snapshot, conflicts: [] };
};
