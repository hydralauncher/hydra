import type { CloudSaveOverview, GameShop } from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { getCloudSaveAutomaticSyncEnabled } from "./automatic-sync-settings";
import { assertCloudSaveSubscription } from "./cloud-save-access";
import { cloudSaveFileKey } from "./cloud-save-contract";
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

  return {
    ...analysis.state,
    state,
    hasChanged: state !== "synced",
    isAutomaticSyncEnabled,
    suggestedAction: getSuggestedCloudSaveAction(
      state,
      analysis.merge.restoreEntryIds.length
    ),
    discoveredVariantCount: analysis.localSnapshot.variants.length,
    unresolvedRemoteVariantCount: new Set(
      (analysis.remoteManifest?.files ?? [])
        .filter((file) => unresolvedEntryIds.has(cloudSaveFileKey(file)))
        .map((file) => file.variantId)
    ).size,
    warnings: analysis.localSnapshot.coverage.filter(
      (item) => item.warningCodes.length > 0
    ),
  };
};
