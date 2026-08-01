import type { GameShop } from "@types";

interface DeleteGameCloudSaveDataDependencies {
  beginPendingDeletion: () => Promise<"prepared" | "remote-started">;
  markRemoteDeletionStarted: () => Promise<void>;
  clearPendingDeletion: () => Promise<void>;
  prepareLocalDeletion: () => Promise<() => Promise<void>>;
  runWithLocalStateLock: (operation: () => Promise<void>) => Promise<void>;
  assertGameNotRunning: () => void;
  deleteRemoteSnapshots: () => Promise<void>;
  clearLocalState: () => Promise<void>;
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
  prepareLocalDeletion,
  runWithLocalStateLock,
  assertGameNotRunning,
  deleteRemoteSnapshots,
  clearLocalState,
}: DeleteGameCloudSaveDataDependencies) => {
  let pendingPhase = await beginPendingDeletion();
  try {
    const deleteLocalFiles = await prepareLocalDeletion();
    await runWithLocalStateLock(async () => {
      assertGameNotRunning();
      pendingPhase = "remote-started";
      await markRemoteDeletionStarted();
      await deleteRemoteSnapshots();
      assertGameNotRunning();
      await deleteLocalFiles();
      await clearLocalState();
      await clearPendingDeletion();
    });
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
