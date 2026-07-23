import type { CloudSaveState, GameShop } from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import type { getCloudSaveGameContext } from "./cloud-save-game-context";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { getCloudSaveSyncAnchor } from "./sync-anchor";

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>
) => {
  const [localSnapshotContext, remoteSnapshots] = await Promise.all([
    buildLocalGameSnapshotContext(objectId, shop, suppliedContext),
    listRemoteGameSnapshots(objectId, shop),
  ]);
  const activeRemoteSnapshot = remoteSnapshots[0] ?? null;
  const remoteManifest = activeRemoteSnapshot
    ? await getRemoteSnapshotRestoreManifest(activeRemoteSnapshot)
    : null;
  if (
    remoteManifest &&
    (remoteManifest.snapshot.shop !== shop ||
      remoteManifest.snapshot.objectId !== objectId)
  ) {
    throw new Error("Active Cloud Save snapshot belongs to another game");
  }

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
    remoteVariants: remoteManifest?.variants ?? [],
    remoteFiles: remoteManifest?.files ?? [],
    base: anchor,
  });
  const mergedAggregateHash =
    merge.files.length > 0
      ? NativeAddon.buildSnapshotAggregateHash({
          variants: merge.variants,
          files: merge.files,
        })
      : null;

  let currentState: CloudSaveState;
  if (!activeRemoteSnapshot) {
    currentState = "untracked";
  } else if (merge.conflicts.length > 0) {
    currentState = "conflict";
  } else if (mergedAggregateHash !== activeRemoteSnapshot.aggregateHash) {
    currentState = "local-ahead";
  } else if (merge.restoreEntryIds.length > 0) {
    currentState = "remote-ahead";
  } else if (merge.partial) {
    currentState = "partial";
  } else {
    currentState = "synced";
  }

  return {
    localSnapshot,
    localSnapshotContext,
    environmentId,
    anchor,
    activeRemoteSnapshot,
    remoteManifest,
    merge,
    mergedAggregateHash,
    state: {
      state: currentState,
      hasChanged: currentState !== "synced",
      activeRemoteSnapshot,
    },
  };
};
