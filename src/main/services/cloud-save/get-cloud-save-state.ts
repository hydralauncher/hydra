import type { CloudSaveStateResult, GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshot } from "./build-local-game-snapshot";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { getCloudSaveSyncAnchor } from "./sync-anchor";

export const getCloudSaveState = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveStateResult> => {
  const [localSnapshot, anchor, remoteSnapshots] = await Promise.all([
    buildLocalGameSnapshot(objectId, shop),
    getCloudSaveSyncAnchor(shop, objectId),
    listRemoteGameSnapshots(objectId, shop),
  ]);

  return NativeAddon.compareGameSnapshots({
    localSnapshotHash: localSnapshot.aggregateHash,
    baseSnapshotHash: anchor?.baseAggregateHash,
    remoteSnapshots,
  });
};
