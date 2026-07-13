import type { GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { getCloudSaveSyncAnchor } from "./sync-anchor";

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop
) => {
  const [localSnapshotContext, anchor, remoteSnapshots] = await Promise.all([
    buildLocalGameSnapshotContext(objectId, shop),
    getCloudSaveSyncAnchor(shop, objectId),
    listRemoteGameSnapshots(objectId, shop),
  ]);
  const { sourceFiles: _, ...localSnapshot } = localSnapshotContext;
  const state = NativeAddon.compareGameSnapshots({
    localSnapshotHash: localSnapshot.aggregateHash,
    baseSnapshotHash: anchor?.baseAggregateHash,
    remoteSnapshots,
  });

  return { localSnapshot, localSnapshotContext, remoteSnapshots, state };
};
