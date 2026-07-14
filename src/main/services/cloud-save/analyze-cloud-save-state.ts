import type { GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { logger } from "../logger";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { getCloudSaveSyncAnchor } from "./sync-anchor";

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop
) => {
  try {
    const [localSnapshotContext, anchor, remoteSnapshots] = await Promise.all([
      buildLocalGameSnapshotContext(objectId, shop),
      getCloudSaveSyncAnchor(shop, objectId),
      listRemoteGameSnapshots(objectId, shop),
    ]);
    const { sourceFiles: _, ...localSnapshot } = localSnapshotContext;
    const state = NativeAddon.compareGameSnapshots({
      localSnapshotHash: localSnapshot.aggregateHash,
      localSnapshotFileCount: localSnapshot.fileCount,
      baseSnapshotHash: anchor?.baseAggregateHash,
      remoteSnapshots,
    });

    logger.info("[Cloud V2 DEBUG] state analysis", {
      shop,
      objectId,
      local: {
        fileCount: localSnapshot.fileCount,
        totalSizeBytes: localSnapshot.totalSizeBytes,
        aggregateHash: localSnapshot.aggregateHash,
      },
      anchor,
      remoteSnapshots,
      result: state,
    });

    return { localSnapshot, localSnapshotContext, remoteSnapshots, state };
  } catch (error) {
    logger.error("[Cloud V2 DEBUG] state analysis error", {
      shop,
      objectId,
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};
