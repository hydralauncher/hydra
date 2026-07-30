import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDeleteGameCloudSaveSnapshotsUrl,
  executeDeleteGameCloudSaveData,
} from "./delete-game-cloud-save-data-policy.ts";

const runWithLocalStateLock = (operation: () => Promise<void>) => operation();

describe("delete all game cloud save data", () => {
  it("builds an encoded request URL for the game", () => {
    assert.equal(
      buildDeleteGameCloudSaveSnapshotsUrl("game id/with spaces", "steam"),
      "/profile/cloud-saves/snapshots?objectId=game+id%2Fwith+spaces&shop=steam"
    );
  });

  it("prepares local files before deleting remotely, then deletes both copies", async () => {
    const calls: string[] = [];

    await executeDeleteGameCloudSaveData({
      getAutomaticSyncEnabled: async () => {
        calls.push("read-setting");
        return true;
      },
      setAutomaticSyncEnabled: async (enabled) => {
        calls.push(`set-setting:${enabled}`);
      },
      prepareLocalDeletion: async () => {
        calls.push("prepare-local");
        return async () => {
          calls.push("delete-local");
        };
      },
      runWithLocalStateLock: async (operation) => {
        calls.push("lock-local-state");
        await operation();
      },
      deleteRemoteSnapshots: async () => {
        calls.push("delete-remote");
      },
      clearLocalState: async () => {
        calls.push("clear-local-state");
      },
    });

    assert.deepEqual(calls, [
      "read-setting",
      "set-setting:false",
      "prepare-local",
      "lock-local-state",
      "delete-remote",
      "delete-local",
      "clear-local-state",
      "set-setting:true",
    ]);
  });

  it("preserves a disabled automatic sync setting after success", async () => {
    const settings: boolean[] = [];

    await executeDeleteGameCloudSaveData({
      getAutomaticSyncEnabled: async () => false,
      setAutomaticSyncEnabled: async (enabled) => {
        settings.push(enabled);
      },
      prepareLocalDeletion: async () => async () => undefined,
      runWithLocalStateLock,
      deleteRemoteSnapshots: async () => undefined,
      clearLocalState: async () => undefined,
    });

    assert.deepEqual(settings, [false, false]);
  });

  it("restores the previous automatic sync setting when deletion fails", async () => {
    const settings: boolean[] = [];

    await assert.rejects(
      executeDeleteGameCloudSaveData({
        getAutomaticSyncEnabled: async () => true,
        setAutomaticSyncEnabled: async (enabled) => {
          settings.push(enabled);
        },
        prepareLocalDeletion: async () => async () => {
          throw new Error("must not run");
        },
        runWithLocalStateLock,
        deleteRemoteSnapshots: async () => {
          throw new Error("network");
        },
        clearLocalState: async () => {
          throw new Error("must not run");
        },
      }),
      /network/
    );

    assert.deepEqual(settings, [false, true]);
  });

  it("restores the previous setting when preparing local deletion fails", async () => {
    const settings: boolean[] = [];

    await assert.rejects(
      executeDeleteGameCloudSaveData({
        getAutomaticSyncEnabled: async () => true,
        setAutomaticSyncEnabled: async (enabled) => {
          settings.push(enabled);
        },
        prepareLocalDeletion: async () => {
          throw new Error("scan");
        },
        runWithLocalStateLock,
        deleteRemoteSnapshots: async () => {
          throw new Error("must not run");
        },
        clearLocalState: async () => {
          throw new Error("must not run");
        },
      }),
      /scan/
    );

    assert.deepEqual(settings, [false, true]);
  });

  it("restores automatic sync when local file deletion fails", async () => {
    const settings: boolean[] = [];
    let anchorsCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData({
        getAutomaticSyncEnabled: async () => true,
        setAutomaticSyncEnabled: async (enabled) => {
          settings.push(enabled);
        },
        prepareLocalDeletion: async () => async () => {
          throw new Error("local-files");
        },
        runWithLocalStateLock,
        deleteRemoteSnapshots: async () => undefined,
        clearLocalState: async () => {
          anchorsCleared = true;
        },
      }),
      /local-files/
    );

    assert.deepEqual(settings, [false, true]);
    assert.equal(anchorsCleared, false);
  });

  it("restores automatic sync when local state cleanup fails", async () => {
    const settings: boolean[] = [];

    await assert.rejects(
      executeDeleteGameCloudSaveData({
        getAutomaticSyncEnabled: async () => true,
        setAutomaticSyncEnabled: async (enabled) => {
          settings.push(enabled);
        },
        prepareLocalDeletion: async () => async () => undefined,
        runWithLocalStateLock,
        deleteRemoteSnapshots: async () => undefined,
        clearLocalState: async () => {
          throw new Error("leveldb");
        },
      }),
      /leveldb/
    );

    assert.deepEqual(settings, [false, true]);
  });

  it("reports when both deletion and rollback fail", async () => {
    await assert.rejects(
      executeDeleteGameCloudSaveData({
        getAutomaticSyncEnabled: async () => true,
        setAutomaticSyncEnabled: async (enabled) => {
          if (enabled) throw new Error("rollback");
        },
        prepareLocalDeletion: async () => async () => undefined,
        runWithLocalStateLock,
        deleteRemoteSnapshots: async () => {
          throw new Error("network");
        },
        clearLocalState: async () => undefined,
      }),
      (error) =>
        error instanceof AggregateError &&
        error.message === "cloud_save_delete_rollback_failed" &&
        error.errors.length === 2
    );
  });
});
