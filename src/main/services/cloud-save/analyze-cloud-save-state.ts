import type {
  CloudSaveCustomPathBindings,
  CloudSaveState,
  GameShop,
} from "@types";

import { NativeAddon } from "../native-addon";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import { reconcileCloudSaveCustomPathsWithRemote } from "./custom-path-store";
import { getInstallationOwnedCustomPathRawPaths } from "./installation-owned-custom-paths";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { getCloudSaveSyncAnchor } from "./sync-anchor";
import type { SyncDirection } from "./sync-game/policy";

interface AnalyzeCloudSaveStateOptions {
  customPathBindings?: CloudSaveCustomPathBindings;
  allowInstallationOwnedCustomPathDeletion?: boolean;
}

const samePaths = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  syncDirection: SyncDirection = "bidirectional",
  options: AnalyzeCloudSaveStateOptions = {}
) => {
  const [context, remoteSnapshots] = await Promise.all([
    suppliedContext ?? getCloudSaveGameContext(objectId, shop),
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
  const trackingState = options.customPathBindings
    ? {
        bindings: options.customPathBindings,
        pendingRawPaths: [],
      }
    : await reconcileCloudSaveCustomPathsWithRemote(
        shop,
        objectId,
        remoteManifest?.customPathRawPaths ?? [],
        cloudSaveCustomPathContextFromPathContext(context.pathContext)
      );
  const customPathBindings = await getUsableCloudSaveCustomPathBindings(
    objectId,
    shop,
    context,
    {
      bindings: trackingState.bindings,
      remoteFiles: remoteManifest?.files ?? [],
    }
  );
  const preserveLocalMissingRawPaths =
    options.allowInstallationOwnedCustomPathDeletion
      ? new Set<string>()
      : await getInstallationOwnedCustomPathRawPaths(
          customPathBindings,
          context.pathContext
        );
  const localSnapshotContext = await buildLocalGameSnapshotContext(
    objectId,
    shop,
    context,
    {
      customPathBindings,
    }
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
    remoteVariants: remoteManifest?.variants ?? [],
    remoteFiles: remoteManifest?.files ?? [],
    base: anchor,
    direction: syncDirection,
    preserveLocalMissingRawPaths,
    treatLocalAsNewRawPaths: new Set(trackingState.pendingRawPaths),
  });
  const mergedCustomPathRawPaths = [
    ...new Set([
      ...(remoteManifest?.customPathRawPaths ?? []),
      ...localSnapshotContext.customPathRawPaths,
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const mergedAggregateHash = NativeAddon.buildSnapshotAggregateHash({
    variants: merge.variants,
    files: merge.files,
  });

  let currentState: CloudSaveState;
  if (!activeRemoteSnapshot) {
    currentState = "untracked";
  } else if (merge.conflicts.length > 0) {
    currentState = "conflict";
  } else if (
    mergedAggregateHash !== activeRemoteSnapshot.aggregateHash ||
    !samePaths(
      mergedCustomPathRawPaths,
      remoteManifest?.customPathRawPaths ?? []
    )
  ) {
    currentState = "local-ahead";
  } else if (
    merge.restoreEntryIds.length > 0 ||
    merge.deleteLocalEntryIds.length > 0
  ) {
    currentState = "remote-ahead";
  } else if (merge.partial) {
    currentState = "partial";
  } else {
    currentState = "synced";
  }

  return {
    context,
    customPathBindings,
    pendingCustomPathRawPaths: trackingState.pendingRawPaths,
    installationOwnedCustomPathRawPaths: [...preserveLocalMissingRawPaths],
    localSnapshot,
    localSnapshotContext,
    environmentId,
    syncDirection,
    anchor,
    activeRemoteSnapshot,
    remoteManifest,
    merge,
    mergedCustomPathRawPaths,
    mergedAggregateHash,
    state: {
      state: currentState,
      hasChanged: currentState !== "synced",
      activeRemoteSnapshot,
    },
  };
};
