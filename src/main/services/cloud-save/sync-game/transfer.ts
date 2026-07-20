import type {
  CloudSaveSyncProgressPayload,
  GameShop,
  LocalGameSnapshotContext,
  RemoteSnapshotSummary,
} from "@types";

import { createRemoteSnapshotFromLocalState } from "../create-remote-snapshot-from-local-state";
import { restoreRemoteSnapshot } from "../restore-remote-snapshot";

export type ProgressCallback = (progress: CloudSaveSyncProgressPayload) => void;

export const uploadLocalState = async (
  objectId: string,
  shop: GameShop,
  localSnapshotContext: LocalGameSnapshotContext,
  emitProgress: ProgressCallback
) => {
  emitProgress({
    gameId: { objectId, shop },
    stage: "uploading",
    processedFiles: 0,
    totalFiles: localSnapshotContext.files.length,
  });
  const snapshot = await createRemoteSnapshotFromLocalState(
    objectId,
    shop,
    (progress) =>
      emitProgress({
        gameId: { objectId, shop },
        stage: "uploading",
        processedFiles: progress.completedFiles,
        totalFiles: progress.totalFiles,
      }),
    localSnapshotContext
  );
  if (!snapshot) throw new Error("Local cloud save snapshot is empty");
};

export const restoreRemoteState = async (
  objectId: string,
  shop: GameShop,
  snapshot: RemoteSnapshotSummary,
  localSnapshotContext: LocalGameSnapshotContext,
  emitProgress: ProgressCallback
) => {
  emitProgress({
    gameId: { objectId, shop },
    stage: "restoring",
    processedFiles: 0,
    totalFiles: snapshot.fileCount,
  });
  const result = await restoreRemoteSnapshot(
    snapshot.id,
    { objectId, shop },
    (progress) =>
      emitProgress({
        gameId: { objectId, shop },
        stage: "restoring",
        processedFiles: progress.processedFiles,
        totalFiles: progress.totalFiles,
      }),
    snapshot,
    {
      environmentId: localSnapshotContext.environmentId,
      pathContext: localSnapshotContext.pathContext,
    }
  );
  if (!result.ok || result.failedFiles > 0) {
    throw new Error(
      `Cloud save restore failed for ${result.failedFiles} file(s)`
    );
  }
};
