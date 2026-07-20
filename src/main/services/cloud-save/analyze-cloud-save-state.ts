import type { GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { getCloudSaveSyncAnchor } from "./sync-anchor";

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop
) => {
  const [localBuild, anchor, remoteSnapshots] = await Promise.all([
    buildLocalGameSnapshotContext(objectId, shop),
    getCloudSaveSyncAnchor(shop, objectId),
    listRemoteGameSnapshots(objectId, shop),
  ]);
  if (localBuild.status === "local-conflict") {
    return {
      status: "local-conflict" as const,
      localSnapshot: null,
      localSnapshotContext: null,
      localConflicts: localBuild.conflicts,
      anchor,
      remoteSnapshots,
      state: {
        state: "local-conflict" as const,
        hasChanged: true,
        activeRemoteSnapshot:
          remoteSnapshots.find((snapshot) => snapshot.status === "active") ??
          null,
      },
    };
  }

  const localSnapshotContext = localBuild.snapshot;
  const { sourceFiles: _, ...localSnapshot } = localSnapshotContext;
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
    status: "ready" as const,
    localSnapshot,
    localSnapshotContext,
    localConflicts: [],
    anchor,
    remoteSnapshots,
    state,
  };
};
