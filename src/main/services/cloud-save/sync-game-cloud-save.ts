import type {
  CloudSaveSyncTrigger,
  GameShop,
  LocalGameSnapshotPipelineResult,
  RemoteSnapshotSummary,
  SyncGameCloudSaveResult,
} from "@types";

import { analyzeCloudSaveState } from "./analyze-cloud-save-state";
import { createRemoteSnapshotFromLocalState } from "./create-remote-snapshot-from-local-state";
import { restoreRemoteSnapshot } from "./restore-remote-snapshot";
import { saveCloudSaveSyncAnchor } from "./sync-anchor";

const activeSyncs = new Map<string, Promise<SyncGameCloudSaveResult>>();

const gameKey = (objectId: string, shop: GameShop) =>
  JSON.stringify([shop, objectId]);

const uploadLocalState = async (
  objectId: string,
  shop: GameShop,
  localSnapshotContext: LocalGameSnapshotPipelineResult
) => {
  const snapshot = await createRemoteSnapshotFromLocalState(
    objectId,
    shop,
    undefined,
    localSnapshotContext
  );
  if (!snapshot) throw new Error("Local cloud save snapshot is empty");
};

const restoreRemoteState = async (
  objectId: string,
  shop: GameShop,
  snapshot: RemoteSnapshotSummary
) => {
  const result = await restoreRemoteSnapshot(
    snapshot.id,
    { objectId, shop },
    undefined,
    snapshot
  );
  if (!result.ok || result.failedFiles > 0) {
    throw new Error(
      `Cloud save restore failed for ${result.failedFiles} file(s)`
    );
  }
};

const runGameCloudSaveSync = async (
  objectId: string,
  shop: GameShop,
  trigger: CloudSaveSyncTrigger
): Promise<SyncGameCloudSaveResult> => {
  const analysis = await analyzeCloudSaveState(objectId, shop);
  const initialState = analysis.state.state;

  if (initialState === "local-ahead") {
    await uploadLocalState(objectId, shop, analysis.localSnapshotContext);

    return { trigger, action: "upload", initialState, finalState: "synced" };
  }

  if (initialState === "remote-ahead") {
    const snapshot = analysis.state.activeRemoteSnapshot;
    if (!snapshot) {
      throw new Error("Active remote cloud save snapshot not found");
    }
    await restoreRemoteState(objectId, shop, snapshot);

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

  if (initialState === "untracked") {
    const hasLocalFiles = analysis.localSnapshot.files.length > 0;
    const remoteSnapshot = analysis.state.activeRemoteSnapshot;

    if (hasLocalFiles && remoteSnapshot) {
      if (
        analysis.localSnapshot.aggregateHash !== remoteSnapshot.aggregateHash
      ) {
        return {
          trigger,
          action: "conflict",
          initialState,
          finalState: "conflict",
        };
      }

      await saveCloudSaveSyncAnchor(shop, objectId, {
        baseSnapshotId: remoteSnapshot.id,
        baseAggregateHash: remoteSnapshot.aggregateHash,
        updatedAt: new Date().toISOString(),
      });
      return { trigger, action: "none", initialState, finalState: "synced" };
    }

    if (hasLocalFiles) {
      await uploadLocalState(objectId, shop, analysis.localSnapshotContext);
      return { trigger, action: "upload", initialState, finalState: "synced" };
    }

    if (remoteSnapshot) {
      await restoreRemoteState(objectId, shop, remoteSnapshot);
      return { trigger, action: "restore", initialState, finalState: "synced" };
    }
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
