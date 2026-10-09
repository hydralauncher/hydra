import type {
  CloudSaveCustomPathBindings,
  CloudSaveState,
  GameShop,
} from "@types";
import { logger } from "@main/services/logger";

import { buildCloudSaveAggregateHash } from "./snapshot-aggregate-hash";
import { buildLocalGameSnapshotContext } from "./build-local-game-snapshot";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getCloudSaveGameContext } from "./cloud-save-game-context";
import { cloudSaveCustomPathContextFromPathContext } from "./custom-path";
import { getUsableCloudSaveCustomPathBindings } from "./custom-path-overlap";
import {
  getCloudSaveCustomPathTrackingState,
  reconcileCloudSaveCustomPathsWithRemote,
} from "./custom-path-store";
import { getInstallationOwnedCustomPathRawPaths } from "./installation-owned-custom-paths";
import {
  isEmulatorSaveRawPath,
  parseRetroArchGameRawPath,
  parseRetroArchSaveRawPath,
} from "./emulator-provider-identity";
import { getEmulatorSaveProvider } from "./emulator-save-provider";
import { listRemoteGameSnapshots } from "./list-remote-game-snapshots";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots";
import { reconcileRemoteTargetObservations } from "./reconcile-remote-target-observations";
import {
  getRemoteSnapshotRestoreManifest,
  resolveRestoreManifestTargets,
} from "./resolve-remote-snapshot-targets";
import {
  getCloudSaveSyncAnchor,
  getCloudSaveSyncAnchorForSnapshot,
} from "./sync-anchor";
import {
  isRetroArchArchivedBattery,
  migrateRetroArchAnchor,
  migrateRetroArchManifest,
} from "./retroarch-snapshot-migration";
import { loadRetroArchBindings } from "./retroarch-state-bindings";
import type { SyncDirection } from "./sync-game/policy";
import { rpcs3SavedataTitleIdsForGame } from "./rpcs3-title-ids.js";

interface AnalyzeCloudSaveStateOptions {
  customPathBindings?: CloudSaveCustomPathBindings;
  allowInstallationOwnedCustomPathDeletion?: boolean;
}

const samePaths = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

const isUnavailableRestoreEnvironment = (error: unknown) =>
  error instanceof Error &&
  (error.message === "cloud_save_restore_prefix_unresolved" ||
    error.message === "cloud_save_restore_prefix_invalid" ||
    error.message === "cloud_save_restore_profile_unresolved");

export const analyzeCloudSaveState = async (
  objectId: string,
  shop: GameShop,
  suppliedContext?: Awaited<ReturnType<typeof getCloudSaveGameContext>>,
  syncDirection: SyncDirection = "bidirectional",
  options: AnalyzeCloudSaveStateOptions = {}
) => {
  const [suppliedOrCurrentContext, remoteSnapshots] = await Promise.all([
    suppliedContext ?? getCloudSaveGameContext(objectId, shop),
    listRemoteGameSnapshots(objectId, shop),
  ]);
  const initialContext =
    getEmulatorSaveProvider(suppliedOrCurrentContext.game) === "rpcs3"
      ? await getCloudSaveGameContext(objectId, shop)
      : suppliedOrCurrentContext;
  const activeRemoteSnapshot = remoteSnapshots[0] ?? null;
  const originalRemoteManifest = activeRemoteSnapshot
    ? await getRemoteSnapshotRestoreManifest(activeRemoteSnapshot)
    : null;
  const retroArchGame =
    initialContext.game &&
    getEmulatorSaveProvider(initialContext.game) === "retroarch"
      ? initialContext.game
      : null;
  const retroArchBindings = retroArchGame
    ? await loadRetroArchBindings(retroArchGame)
    : null;
  const migration =
    retroArchGame && originalRemoteManifest
      ? migrateRetroArchManifest(
          retroArchGame,
          originalRemoteManifest,
          retroArchBindings?.selectedLegacyBatteryRawPath
        )
      : null;
  const remoteManifest = migration?.manifest ?? originalRemoteManifest;
  if (migration?.conflicts.length) {
    throw new Error("cloud_save_retroarch_legacy_battery_conflict");
  }
  if (
    remoteManifest &&
    (remoteManifest.snapshot.shop !== shop ||
      remoteManifest.snapshot.objectId !== objectId)
  ) {
    throw new Error("Active Cloud Save snapshot belongs to another game");
  }
  let rpcs3AllowedTitleIds: ReadonlySet<string> | null = null;
  let rpcs3SavedataTitleIds: string[] | undefined;
  if (getEmulatorSaveProvider(initialContext.game) === "rpcs3") {
    const { assertRpcs3DiscIdentity, assertRpcs3SnapshotIdentity } =
      await import("./rpcs3-game-identity.js");
    rpcs3AllowedTitleIds = await assertRpcs3DiscIdentity(initialContext.game!);
    rpcs3SavedataTitleIds = rpcs3SavedataTitleIdsForGame(
      initialContext.game!,
      rpcs3AllowedTitleIds
    );
    assertRpcs3SnapshotIdentity(
      (remoteManifest?.files ?? []).filter(
        (file) => !file.rawPath.startsWith("<custom>")
      ),
      rpcs3AllowedTitleIds,
      [],
      new Set(rpcs3SavedataTitleIds)
    );
  }
  const context = initialContext;
  const currentAnchor = await getCloudSaveSyncAnchor(
    shop,
    objectId,
    context.environmentId,
    { allowEnvironmentFallback: !activeRemoteSnapshot }
  );
  const originalAnchor =
    retroArchGame && activeRemoteSnapshot
      ? (currentAnchor ??
        (await getCloudSaveSyncAnchorForSnapshot(
          shop,
          objectId,
          activeRemoteSnapshot.id
        )))
      : currentAnchor;
  if (retroArchGame && migration && originalAnchor) {
    const { seedRetroArchBindingsFromLegacyAnchor } = await import(
      "./retroarch-save-provider"
    );
    await seedRetroArchBindingsFromLegacyAnchor(
      retroArchGame,
      originalAnchor,
      migration.stateIdByLegacyKey
    );
  }
  const anchor =
    retroArchGame && activeRemoteSnapshot
      ? migrateRetroArchAnchor(
          retroArchGame,
          originalAnchor,
          context.environmentId,
          migration?.selectedBatteryRawPath,
          migration?.stateIdByLegacyKey
        )
      : currentAnchor;
  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    context.pathContext
  );
  let trackingState: Awaited<
    ReturnType<typeof getCloudSaveCustomPathTrackingState>
  >;
  if (options.customPathBindings) {
    trackingState = {
      bindings: options.customPathBindings,
      pendingRawPaths: [],
    };
  } else if (!remoteManifest && anchor) {
    trackingState = await getCloudSaveCustomPathTrackingState(
      shop,
      objectId,
      customPathContext
    );
  } else {
    trackingState = await reconcileCloudSaveCustomPathsWithRemote(
      shop,
      objectId,
      remoteManifest?.customPathRawPaths ?? [],
      customPathContext
    );
  }
  const customPathBindings = await getUsableCloudSaveCustomPathBindings(
    objectId,
    shop,
    context,
    {
      bindings: trackingState.bindings,
      remoteFiles: remoteManifest?.files ?? [],
    }
  );
  if (rpcs3AllowedTitleIds) {
    const { assertRpcs3SnapshotIdentity } = await import(
      "./rpcs3-game-identity.js"
    );
    assertRpcs3SnapshotIdentity(
      remoteManifest?.files ?? [],
      rpcs3AllowedTitleIds,
      customPathBindings.ready,
      new Set(rpcs3SavedataTitleIds)
    );
  }
  const preserveLocalMissingRawPaths =
    options.allowInstallationOwnedCustomPathDeletion
      ? new Set<string>()
      : await getInstallationOwnedCustomPathRawPaths(
          customPathBindings,
          context.pathContext
        );
  const preserveLocalMissingEntryIds = new Set(
    (remoteManifest?.files ?? [])
      .filter(
        (file) =>
          parseRetroArchSaveRawPath(file.rawPath) &&
          /^battery\.(?:sav|eep|sra|fla|mpk)$/.test(file.relativePath)
      )
      .map(cloudSaveFileKey)
  );
  const preserveCloudOnlyEntryIds = new Set(
    (remoteManifest?.files ?? [])
      .filter(isRetroArchArchivedBattery)
      .map(cloudSaveFileKey)
  );
  if (
    retroArchGame &&
    remoteManifest?.files.some(
      (file) => file.relativePath === "transfer-pak.sav"
    )
  ) {
    const { locationsForGame } = await import("./retroarch-save-provider");
    const activeLocation = await locationsForGame(retroArchGame)
      .then(({ activeLocation }) => activeLocation)
      .catch(() => null);
    if (!activeLocation?.hasTransferPak) {
      for (const file of remoteManifest.files) {
        if (
          file.relativePath === "transfer-pak.sav" &&
          parseRetroArchGameRawPath(file.rawPath)
        ) {
          preserveCloudOnlyEntryIds.add(cloudSaveFileKey(file));
        }
      }
    }
  }
  let localSnapshotContext = await buildLocalGameSnapshotContext(
    objectId,
    shop,
    context,
    {
      customPathBindings,
      remoteFiles: remoteManifest?.files ?? [],
      rpcs3SavedataTitleIds,
    }
  );
  if (rpcs3AllowedTitleIds) {
    const { assertRpcs3SnapshotIdentity } = await import(
      "./rpcs3-game-identity.js"
    );
    assertRpcs3SnapshotIdentity(
      localSnapshotContext.files,
      rpcs3AllowedTitleIds,
      customPathBindings.ready,
      new Set(rpcs3SavedataTitleIds)
    );
  }
  const restorableEmulatorEntryIds = new Set<string>();

  if (remoteManifest) {
    const localEntryIds = new Set(
      localSnapshotContext.files.map(cloudSaveFileKey)
    );
    const missingRemoteFiles = remoteManifest.files.filter(
      (file) => !localEntryIds.has(cloudSaveFileKey(file))
    );
    if (missingRemoteFiles.length > 0) {
      const usedVariantIds = new Set(
        missingRemoteFiles.map((file) => file.variantId)
      );
      try {
        const resolution = await resolveRestoreManifestTargets(
          {
            ...remoteManifest,
            variants: remoteManifest.variants.filter((variant) =>
              usedVariantIds.has(variant.variantId)
            ),
            files: missingRemoteFiles,
          },
          context.pathContext,
          customPathBindings,
          rpcs3SavedataTitleIds
        );
        for (const action of resolution.actions) {
          if (isEmulatorSaveRawPath(action.rawPath)) {
            restorableEmulatorEntryIds.add(cloudSaveFileKey(action));
          }
        }
        localSnapshotContext = reconcileRemoteTargetObservations(
          localSnapshotContext,
          remoteManifest.variants,
          missingRemoteFiles,
          resolution,
          buildCloudSaveAggregateHash
        );
      } catch (error) {
        if (!isUnavailableRestoreEnvironment(error)) throw error;
        logger.info(
          "[Cloud Save] Skipping remote target observation without a usable restore environment",
          { shop, objectId, error }
        );
      }
    }
  }

  const {
    sourceFiles: _,
    environmentId,
    pathContext: __,
    ...localSnapshot
  } = localSnapshotContext;
  const merge = mergeUserVariantSnapshots({
    local: localSnapshotContext,
    remoteVariants: remoteManifest?.variants ?? [],
    remoteFiles: remoteManifest?.files ?? [],
    base: anchor,
    direction: syncDirection,
    preserveLocalMissingRawPaths,
    preserveLocalMissingEntryIds,
    preserveCloudOnlyEntryIds,
    restorableEmulatorEntryIds,
    treatLocalAsNewRawPaths: new Set(trackingState.pendingRawPaths),
  });
  const mergedCustomPathRawPaths = [
    ...new Set([
      ...(remoteManifest?.customPathRawPaths ?? []),
      ...localSnapshotContext.customPathRawPaths,
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const mergedAggregateHash = buildCloudSaveAggregateHash({
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
    preserveCloudOnlyEntryIds: [...preserveCloudOnlyEntryIds],
    restorableEmulatorEntryIds: [...restorableEmulatorEntryIds],
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
