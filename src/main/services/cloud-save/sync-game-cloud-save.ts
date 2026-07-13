import type {
  CloudSaveSyncTrigger,
  GameShop,
  SyncGameCloudSaveResult,
} from "@types";

import { createRemoteSnapshotFromLocalState } from "./create-remote-snapshot-from-local-state";
import { getCloudSaveState } from "./get-cloud-save-state";
import { restoreRemoteSnapshot } from "./restore-remote-snapshot";

const activeSyncs = new Map<string, Promise<SyncGameCloudSaveResult>>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

const runGameCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger
): Promise<SyncGameCloudSaveResult> => {
  const cloudSaveState = await getCloudSaveState(objectId, shop);
  const initialState = cloudSaveState.state;

  if (initialState === "local-ahead") {
    const snapshot = await createRemoteSnapshotFromLocalState(objectId, shop);
    if (!snapshot) {
      throw new Error("Local cloud save snapshot is empty");
    }

    return { trigger, action: "upload", initialState, finalState: "synced" };
  }

  if (initialState === "remote-ahead") {
    const snapshot = cloudSaveState.activeRemoteSnapshot;
    if (!snapshot) {
      throw new Error("Active remote cloud save snapshot not found");
    }

    const result = await restoreRemoteSnapshot(snapshot.id, { objectId, shop });
    if (!result.ok || result.failedFiles > 0) {
      throw new Error(
        `Cloud save restore failed for ${result.failedFiles} file(s)`
      );
    }

    return { trigger, action: "restore", initialState, finalState: "synced" };
  }

  if (initialState === "conflict") {
    return {
      trigger,
      action: "conflict",
      initialState,
      finalState: "conflict",
    };
  }

  return {
    trigger,
    action: "none",
    initialState,
    finalState: initialState,
  };
};

export const syncGameCloudSave = (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger
): Promise<SyncGameCloudSaveResult> => {
  const key = gameKey(objectId, shop);
  const activeSync = activeSyncs.get(key);
  if (activeSync) return activeSync;

  const sync = runGameCloudSaveSync(objectId, shop, trigger).finally(() => {
    if (activeSyncs.get(key) === sync) activeSyncs.delete(key);
  });
  activeSyncs.set(key, sync);
  return sync;
};
