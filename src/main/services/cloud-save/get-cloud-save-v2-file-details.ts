import type {
  CloudSaveUnresolvedCustomPath,
  CloudSaveV2FileDetails,
  GameShop,
} from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { loadCloudSaveV2FileDetails } from "./cloud-save-v2-file-details";
import { classifyCloudSaveCustomPathResolutionError } from "./custom-path-binding-state";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { getFirstSyncState } from "./sync-game";
import { getEmulatorSaveProvider } from "./emulator-save-provider";
import {
  getEmulatorDestinationBinding,
  getExpectedEmulatorDestination,
  isSafeExistingEmulatorDestination,
  isVerifiedEmulatorDestinationBinding,
} from "./emulator-destination-store";
import { groupEmulatorRestoreDestinations } from "./emulator-destination-policy";
import { setRetroArchFileDisplayNames } from "./retroarch-file-display-names";
import {
  cloudSaveCustomPathContextFromPathContext,
  decodeCloudSaveCustomPath,
  getLegacyCloudSaveCustomPathPathHint,
} from "./custom-path";

const describeUnregisteredCustomPath = (
  rawPath: string,
  context: Parameters<typeof decodeCloudSaveCustomPath>[1]
): CloudSaveUnresolvedCustomPath => {
  const legacyPathHint = getLegacyCloudSaveCustomPathPathHint(rawPath);
  if (legacyPathHint) {
    return {
      rawPath,
      pathHint: legacyPathHint,
      state: "needs-confirmation",
      reason: "legacy",
      registered: false,
    };
  }

  try {
    return {
      rawPath,
      pathHint: decodeCloudSaveCustomPath(rawPath, context).path,
      state: "needs-confirmation",
      reason: "unregistered",
      registered: false,
    };
  } catch (error) {
    const classified = classifyCloudSaveCustomPathResolutionError(error);
    if (classified.state === "invalid") {
      return {
        rawPath,
        pathHint: null,
        ...classified,
        registered: false,
      };
    }
    return {
      rawPath,
      pathHint: null,
      state: "needs-confirmation",
      reason:
        classified.reason === "foreign-platform"
          ? "foreign-platform"
          : "unregistered",
      registered: false,
    };
  }
};

export const getCloudSaveV2FileDetails = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveV2FileDetails> => {
  assertCloudSaveSubscription();

  const analysis = await analyzeCloudSaveState(objectId, shop);
  const customPathContext = cloudSaveCustomPathContextFromPathContext(
    analysis.localSnapshotContext.pathContext
  );
  const bindings = analysis.customPathBindings;
  const state =
    analysis.state.state === "untracked"
      ? getFirstSyncState(analysis)
      : analysis.state.state;

  const details = await loadCloudSaveV2FileDetails(
    {
      objectId,
      shop,
      state,
      localVariants: analysis.localSnapshot.variants,
      localFiles: analysis.localSnapshot.files,
      localSourceFiles: analysis.localSnapshotContext.sourceFiles,
      localTotalSizeBytes: analysis.localSnapshot.totalSizeBytes,
      activeSnapshot: analysis.state.activeRemoteSnapshot,
      coverage: analysis.localSnapshot.coverage,
      unresolvedRemoteEntryIds:
        analysis.anchor?.unresolvedRemoteEntryIds ??
        analysis.merge.unresolvedRemoteEntryIds,
      conflictEntryIds: analysis.merge.conflicts.map(
        (conflict) => conflict.entryId
      ),
      customPaths: bindings.ready,
      unresolvedCustomPaths: bindings.unresolved,
      describeUnregisteredCustomPath: (rawPath) =>
        describeUnregisteredCustomPath(rawPath, customPathContext),
    },
    async (snapshot) =>
      analysis.remoteManifest?.snapshot.id === snapshot.id
        ? analysis.remoteManifest
        : getRemoteSnapshotRestoreManifest(snapshot)
  );
  const provider = getEmulatorSaveProvider(analysis.context.game);
  if (provider === "retroarch" && analysis.context.game) {
    const game = analysis.context.game;
    const activeLocation = await import("./retroarch-save-provider")
      .then(({ locationsForGame }) => locationsForGame(game))
      .then((locations) => locations.activeLocation)
      .catch(() => null);
    const stateBindings = activeLocation
      ? await import("./retroarch-state-bindings")
          .then(({ loadRetroArchBindings }) => loadRetroArchBindings(game))
          .then((bindings) => bindings.states)
          .catch(() => undefined)
      : undefined;
    setRetroArchFileDisplayNames(
      details,
      activeLocation ?? null,
      stateBindings
    );
  }
  if (analysis.context.game && provider) {
    const pending = new Set(analysis.merge.unresolvedRemoteEntryIds);
    const safeAutomatic = new Set(analysis.restorableEmulatorEntryIds);
    const grouped = groupEmulatorRestoreDestinations(
      analysis.remoteManifest?.files ?? [],
      pending,
      safeAutomatic
    );
    details.emulatorDestinations = (
      await Promise.all(
        grouped.map(async (group) => {
          const selectedPath = await getEmulatorDestinationBinding(
            analysis.context.game!,
            group.rawPath,
            group.kind
          ).catch(() => null);
          if (!group.needsDestination) return null;
          const pathHint = await getExpectedEmulatorDestination(
            analysis.context.game!,
            group.rawPath,
            group.kind,
            group.relativePath
          ).catch(() => null);
          const available =
            pathHint !== null &&
            (await isSafeExistingEmulatorDestination(pathHint));
          const verified =
            available &&
            selectedPath !== null &&
            (await isVerifiedEmulatorDestinationBinding(
              analysis.context.game!,
              group.rawPath,
              group.kind,
              group.relativePath,
              pathHint!
            ).catch(() => false));
          return {
            rawPath: group.rawPath,
            kind: group.kind,
            pathHint,
            selectedPath,
            fileCount: group.fileCount,
            status: verified
              ? ("bound" as const)
              : available
                ? ("pending" as const)
                : ("unavailable" as const),
          };
        })
      )
    ).filter((item) => item !== null);
  }
  return details;
};
