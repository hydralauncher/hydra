import type { CloudSaveState, GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { getCloudSaveHead } from "./get-cloud-save-head";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots";
import { getCloudSaveSyncAnchor } from "./sync-anchor";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>
) => {
  const [localSnapshotContext, remoteHead, remoteSnapshots] = await Promise.all(
    [
      buildLocalGameSnapshotContext(objectId, shop, suppliedContext),
      getCloudSaveHead(objectId, shop),
      listRemoteGameSnapshots(objectId, shop),
    ]
  );
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
  const merge = mergeUserVariantSnapshots({
    local: localSnapshotContext,
    remoteFiles: remoteHead.files,
    base: anchor,
  });
  const mergedAggregateHash = NativeAddon.buildSnapshotAggregateHash({
    schemaVersion: localSnapshot.schemaVersion,
    saveNamespaceKey: localSnapshot.saveNamespaceKey,
    files: merge.files,
  });
  const activeRemoteSnapshot = remoteHead.snapshotId
    ? (remoteSnapshots.find(
        (snapshot) =>
          snapshot.id === remoteHead.snapshotId && snapshot.status === "active"
      ) ?? null)
    : null;
  if (remoteHead.snapshotId && !activeRemoteSnapshot) {
    throw new Error("Cloud Save head snapshot is missing from snapshot list");
  }

  let currentState: CloudSaveState;
  if (!remoteHead.snapshotId) {
    currentState = "untracked";
  } else if (merge.conflicts.length > 0) {
    currentState = "conflict";
  } else if (mergedAggregateHash !== remoteHead.snapshotHash) {
    currentState = "local-ahead";
  } else if (merge.restoreEntryIds.length > 0) {
    currentState = "remote-ahead";
  } else if (merge.partial) {
    currentState = "partial";
  } else {
    currentState = "synced";
  }
  const state = {
    state: currentState,
    hasChanged: currentState !== "synced",
    activeRemoteSnapshot,
  };

  return {
    localSnapshot,
    localSnapshotContext,
    environmentId,
    anchor,
    remoteHead,
    remoteSnapshots,
    merge,
    mergedAggregateHash,
    state,
  };
};
