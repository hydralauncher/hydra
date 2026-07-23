import type { CloudSaveOverview, GameShop } from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { getCloudSaveAutomaticSyncEnabled } from "./automatic-sync-settings";
import { getFirstSyncState } from "./sync-game";

export const getCloudSaveOverview = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveOverview> => {
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
    snapshots: analysis.remoteSnapshots,
    isAutomaticSyncEnabled,
    discoveredVariantCount: new Set(
      analysis.localSnapshot.files.map((file) => file.variantId)
    ).size,
    unresolvedRemoteVariantCount: new Set(
      analysis.remoteHead.files
        .filter((file) => unresolvedEntryIds.has(file.logicalFileId))
        .map((file) => file.variantId)
    ).size,
    warnings: analysis.localSnapshot.coverage.filter(
      (item) => item.warningCodes.length > 0
    ),
  };
};
