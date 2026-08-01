import type { GameShop } from "@types";

interface DeleteGameCloudSaveDataDependencies {
  beginPendingDeletion: () => Promise<"prepared" | "remote-started">;
  markRemoteDeletionStarted: () => Promise<void>;
  clearPendingDeletion: () => Promise<void>;
  runWithLocalDeletionSnapshot: (
    operation: (snapshot: {
      deleteLocalFiles: () => Promise<void>;
      clearLocalState: () => Promise<void>;
    }) => Promise<void>
  ) => Promise<void>;
  assertGameNotRunning: () => void;
  deleteRemoteSnapshots: () => Promise<void>;
}

export const buildDeleteGameCloudSaveSnapshotsUrl = (
  objectId: string,
  shop: GameShop
) => {
  const params = new URLSearchParams({ objectId, shop });
  return `/profile/cloud-saves/snapshots?${params.toString()}`;
};

export const executeDeleteGameCloudSaveData = async ({
  beginPendingDeletion,
  markRemoteDeletionStarted,
  clearPendingDeletion,
  runWithLocalDeletionSnapshot,
  assertGameNotRunning,
  deleteRemoteSnapshots,
}: DeleteGameCloudSaveDataDependencies) => {
  let pendingPhase = await beginPendingDeletion();
  try {
    await runWithLocalDeletionSnapshot(
      async ({ deleteLocalFiles, clearLocalState }) => {
        assertGameNotRunning();
        pendingPhase = "remote-started";
        await markRemoteDeletionStarted();
        await deleteRemoteSnapshots();
        assertGameNotRunning();
        await deleteLocalFiles();
        await clearLocalState();
        await clearPendingDeletion();
      }
    );
  } catch (error) {
    if (pendingPhase === "prepared") {
      try {
        await clearPendingDeletion();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "cloud_save_delete_rollback_failed"
        );
      }
    }
    throw error;
  }
};
