import type { GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { getCloudSaveSyncAnchor } from "./sync-anchor";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>
) => {
  const [localSnapshotContext, remoteSnapshots] = await Promise.all([
    buildLocalGameSnapshotContext(objectId, shop, suppliedContext),
    listRemoteGameSnapshots(objectId, shop),
  ]);
  const {
    sourceFiles: _,
    environmentId,
    pathContext: __,
    ...localSnapshot
  } = localSnapshotContext;
  const anchor = await getCloudSaveSyncAnchor(
    shop,
    objectId,
    environmentId,
    localSnapshot.aggregateHash,
    localSnapshot.fileCount
  );
  const comparison = NativeAddon.compareGameSnapshots({
    localSnapshotHash: localSnapshot.aggregateHash,
    localSnapshotFileCount: localSnapshot.fileCount,
    baseSnapshotHash: anchor?.baseAggregateHash,
    remoteSnapshots,
  });
  const state = {
    state: comparison.state,
    hasChanged: comparison.isOutOfSync,
    activeRemoteSnapshot: comparison.activeRemoteSnapshot,
  };

  return {
    localSnapshot,
    localSnapshotContext,
    environmentId,
    anchor,
    remoteSnapshots,
    state,
  };
};
