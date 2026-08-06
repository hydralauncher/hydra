import type { CloudSaveOverview, GameShop } from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import {
  buildCloudSaveObservationKey,
  recordLatestCloudSaveObservation,
} from "./automatic-sync-observation";
import { getCloudSaveAutomaticSyncEnabled } from "./automatic-sync-settings";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
import { getUnconfiguredCloudSaveCustomPathCandidates } from "./custom-path-approval-policy";
import { getFirstSyncState, getSuggestedCloudSaveAction } from "./sync-game";

export const getCloudSaveOverview = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveOverview> => {
  assertCloudSaveSubscription();

  const [analysis, isAutomaticSyncEnabled] = await Promise.all([
    analyzeCloudSaveState(objectId, shop),
    getCloudSaveAutomaticSyncEnabled(objectId, shop),
  ]);
  const state =
    analysis.state.state === "untracked"
      ? getFirstSyncState(analysis)
      : analysis.state.state;
  const unresolvedEntryIds = new Set([
    ...(analysis.anchor?.unresolvedRemoteEntryIds ?? []),
    ...analysis.merge.unresolvedRemoteEntryIds,
  ]);
  const unconfiguredCustomPathCount =
    getUnconfiguredCloudSaveCustomPathCandidates(
      analysis.remoteManifest?.files ?? [],
      [
        ...analysis.customPathBindings.ready,
        ...analysis.customPathBindings.unresolved,
      ].map(({ rawPath }) => rawPath)
    ).length;
  recordLatestCloudSaveObservation(
    objectId,
    shop,
    buildCloudSaveObservationKey(analysis)
  );
  let localSnapshotUpdatedAt: string | null = null;
  for (const file of analysis.localSnapshot.files) {
    if (
      !localSnapshotUpdatedAt ||
      Date.parse(file.lastModifiedAt) > Date.parse(localSnapshotUpdatedAt)
    ) {
      localSnapshotUpdatedAt = file.lastModifiedAt;
    }
  }

  return {
    ...analysis.state,
    state,
    hasChanged: state !== "synced",
    localSnapshotSummary: {
      updatedAt: localSnapshotUpdatedAt,
      totalSizeBytes: analysis.localSnapshot.totalSizeBytes,
    },
    isAutomaticSyncEnabled,
    suggestedAction: getSuggestedCloudSaveAction(
      state,
      analysis.merge.restoreEntryIds.length +
        analysis.merge.deleteLocalEntryIds.length
    ),
    discoveredVariantCount: analysis.localSnapshot.variants.length,
    unresolvedRemoteVariantCount: new Set(
      (analysis.remoteManifest?.files ?? [])
        .filter((file) => unresolvedEntryIds.has(cloudSaveFileKey(file)))
        .map((file) => file.variantId)
    ).size,
    unconfiguredCustomPathCount,
    warnings: analysis.localSnapshot.coverage.filter(
      (item) => item.warningCodes.length > 0
    ),
  };
};
