import type { CloudSaveV2FileDetails, GameShop } from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { loadCloudSaveV2FileDetails } from "./cloud-save-v2-file-details";
import { getRemoteSnapshotRestoreManifest } from "./resolve-remote-snapshot-targets";
import { getFirstSyncState } from "./sync-game";

export const getCloudSaveV2FileDetails = async (
  objectId: string,
  shop: GameShop
): Promise<CloudSaveV2FileDetails> => {
  const analysis = await analyzeCloudSaveState(objectId, shop);
  const state =
    analysis.state.state === "untracked"
      ? getFirstSyncState(analysis)
      : analysis.state.state;

  return loadCloudSaveV2FileDetails(
    {
      objectId,
      shop,
      state,
      localFiles: analysis.localSnapshot.files,
      localSourceFiles: analysis.localSnapshotContext.sourceFiles,
      localTotalSizeBytes: analysis.localSnapshot.totalSizeBytes,
      activeSnapshot: analysis.state.activeRemoteSnapshot,
      coverage: analysis.localSnapshot.coverage,
      unresolvedRemoteEntryIds:
        analysis.anchor?.unresolvedRemoteEntryIds ??
        analysis.merge.unresolvedRemoteEntryIds,
      conflictLogicalFileIds: analysis.merge.conflicts.map(
        (conflict) => conflict.logicalFileId
      ),
    },
    getRemoteSnapshotRestoreManifest
  );
};
