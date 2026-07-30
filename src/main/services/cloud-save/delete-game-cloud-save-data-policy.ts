import type { GameShop } from "@types";

interface DeleteGameCloudSaveDataDependencies {
  getAutomaticSyncEnabled: () => Promise<boolean>;
  setAutomaticSyncEnabled: (enabled: boolean) => Promise<unknown>;
  prepareLocalDeletion: () => Promise<() => Promise<void>>;
  runWithLocalStateLock: (operation: () => Promise<void>) => Promise<void>;
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
  getAutomaticSyncEnabled,
  setAutomaticSyncEnabled,
  prepareLocalDeletion,
  runWithLocalStateLock,
  deleteRemoteSnapshots,
  clearLocalState,
}: DeleteGameCloudSaveDataDependencies) => {
  const wasAutomaticSyncEnabled = await getAutomaticSyncEnabled();
  await setAutomaticSyncEnabled(false);

  let operationError: unknown;
  try {
    const deleteLocalFiles = await prepareLocalDeletion();
    await runWithLocalStateLock(async () => {
      await deleteRemoteSnapshots();
      await deleteLocalFiles();
      await clearLocalState();
    });
  } catch (error) {
    operationError = error;
  }

  try {
    await setAutomaticSyncEnabled(wasAutomaticSyncEnabled);
  } catch (restoreError) {
    if (operationError) {
      throw new AggregateError(
        [operationError, restoreError],
        "cloud_save_delete_rollback_failed"
      );
    }
    throw restoreError;
  }

  if (operationError) throw operationError;
};
