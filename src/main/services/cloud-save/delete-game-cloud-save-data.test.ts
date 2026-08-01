import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CloudSaveOperationCoordinator } from "./operation-coordinator.ts";
import {
  buildDeleteGameCloudSaveSnapshotsUrl,
  executeDeleteGameCloudSaveData,
} from "./delete-game-cloud-save-data-policy.ts";

type Dependencies = Parameters<typeof executeDeleteGameCloudSaveData>[0];

const createDependencies = (
  overrides: Partial<Dependencies> = {}
): Dependencies => ({
  beginPendingDeletion: async () => "prepared",
  markRemoteDeletionStarted: async () => undefined,
  clearPendingDeletion: async () => undefined,
  runWithLocalDeletionSnapshot: (operation) =>
    operation({
      deleteLocalFiles: async () => undefined,
      clearLocalState: async () => undefined,
    }),
  assertGameNotRunning: () => undefined,
  deleteRemoteSnapshots: async () => undefined,
  ...overrides,
});

describe("delete all game cloud save data", () => {
  it("builds an encoded request URL for the game", () => {
    assert.equal(
      buildDeleteGameCloudSaveSnapshotsUrl("game id/with spaces", "steam"),
      "/profile/cloud-saves/snapshots?objectId=game+id%2Fwith+spaces&shop=steam"
    );
  });

  it("locks before preparation and clears only after local state", async () => {
    const calls: string[] = [];

    await executeDeleteGameCloudSaveData(
      createDependencies({
        beginPendingDeletion: async () => {
          calls.push("begin-pending");
          return "prepared";
        },
        runWithLocalDeletionSnapshot: async (operation) => {
          calls.push("lock-local-state");
          calls.push("prepare-local");
          await operation({
            deleteLocalFiles: async () => {
              calls.push("delete-local");
            },
            clearLocalState: async () => {
              calls.push("clear-local-state");
            },
          });
        },
        assertGameNotRunning: () => {
          calls.push("assert-game-not-running");
        },
        markRemoteDeletionStarted: async () => {
          calls.push("mark-remote-started");
        },
        deleteRemoteSnapshots: async () => {
          calls.push("delete-remote");
        },
        clearPendingDeletion: async () => {
          calls.push("clear-pending");
        },
      })
    );

    assert.deepEqual(calls, [
      "begin-pending",
      "lock-local-state",
      "prepare-local",
      "assert-game-not-running",
      "mark-remote-started",
      "delete-remote",
      "assert-game-not-running",
      "delete-local",
      "clear-local-state",
      "clear-pending",
    ]);
  });

  it("includes a custom path mutation that was already ahead of deletion", async () => {
    const coordinator = new CloudSaveOperationCoordinator<void>();
    const bindings = ["existing"];
    const deletedBindings: string[] = [];
    let releaseMutation!: () => void;
    const mutationBlocked = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });

    const mutation = coordinator.run("game", "rebind", async () => {
      await mutationBlocked;
      bindings.push("rebound");
    });
    const deletion = executeDeleteGameCloudSaveData(
      createDependencies({
        runWithLocalDeletionSnapshot: (operation) =>
          coordinator.run("game", "delete", async () => {
            const bindingSnapshot = [...bindings];
            await operation({
              deleteLocalFiles: async () => {
                deletedBindings.push(...bindingSnapshot);
              },
              clearLocalState: async () => undefined,
            });
          }),
      })
    );

    releaseMutation();
    await Promise.all([mutation, deletion]);

    assert.deepEqual(deletedBindings, ["existing", "rebound"]);
  });

  it("does not let a later custom path mutation interleave with deletion", async () => {
    const coordinator = new CloudSaveOperationCoordinator<void>();
    const bindings = ["existing"];
    const deletedBindings: string[] = [];
    let signalPrepared!: () => void;
    let releaseRemote!: () => void;
    const prepared = new Promise<void>((resolve) => {
      signalPrepared = resolve;
    });
    const remoteBlocked = new Promise<void>((resolve) => {
      releaseRemote = resolve;
    });

    const deletion = executeDeleteGameCloudSaveData(
      createDependencies({
        runWithLocalDeletionSnapshot: (operation) =>
          coordinator.run("game", "delete", async () => {
            const bindingSnapshot = [...bindings];
            signalPrepared();
            await operation({
              deleteLocalFiles: async () => {
                deletedBindings.push(...bindingSnapshot);
              },
              clearLocalState: async () => {
                assert.deepEqual(bindings, ["existing"]);
              },
            });
          }),
        deleteRemoteSnapshots: () => remoteBlocked,
      })
    );
    await prepared;

    const mutation = coordinator.run("game", "rebind", async () => {
      bindings.push("late-rebind");
    });
    await Promise.resolve();
    assert.deepEqual(bindings, ["existing"]);

    releaseRemote();
    await Promise.all([deletion, mutation]);

    assert.deepEqual(deletedBindings, ["existing"]);
    assert.deepEqual(bindings, ["existing", "late-rebind"]);
  });

  it("clears a prepared quarantine when preparation fails", async () => {
    let pendingCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          runWithLocalDeletionSnapshot: async () => {
            throw new Error("scan");
          },
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /scan/
    );

    assert.equal(pendingCleared, true);
  });

  it("releases the custom path lock when preparation fails", async () => {
    const coordinator = new CloudSaveOperationCoordinator<void>();
    let pendingCleared = false;
    let laterMutationRan = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          runWithLocalDeletionSnapshot: () =>
            coordinator.run("game", "delete", async () => {
              throw new Error("migration");
            }),
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /migration/
    );
    await coordinator.run("game", "rebind", async () => {
      laterMutationRan = true;
    });

    assert.equal(pendingCleared, true);
    assert.equal(laterMutationRan, true);
  });

  it("reports when a pre-remote failure and quarantine cleanup both fail", async () => {
    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          runWithLocalDeletionSnapshot: async () => {
            throw new Error("scan");
          },
          clearPendingDeletion: async () => {
            throw new Error("leveldb");
          },
        })
      ),
      (error) =>
        error instanceof AggregateError &&
        error.message === "cloud_save_delete_rollback_failed" &&
        error.errors.length === 2
    );
  });

  it("keeps a recovered remote-started quarantine when preparation fails", async () => {
    let pendingCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          beginPendingDeletion: async () => "remote-started",
          runWithLocalDeletionSnapshot: async () => {
            throw new Error("scan");
          },
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /scan/
    );

    assert.equal(pendingCleared, false);
  });

  it("does not delete remotely when the game starts before the remote boundary", async () => {
    let remoteStarted = false;
    let remoteDeleted = false;
    let pendingCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          assertGameNotRunning: () => {
            throw new Error("cloud_save_delete_game_running");
          },
          markRemoteDeletionStarted: async () => {
            remoteStarted = true;
          },
          deleteRemoteSnapshots: async () => {
            remoteDeleted = true;
          },
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /cloud_save_delete_game_running/
    );

    assert.equal(remoteStarted, false);
    assert.equal(remoteDeleted, false);
    assert.equal(pendingCleared, true);
  });

  it("keeps quarantine when marking the remote boundary fails", async () => {
    let pendingCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          markRemoteDeletionStarted: async () => {
            throw new Error("leveldb");
          },
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /leveldb/
    );

    assert.equal(pendingCleared, false);
  });

  it("keeps quarantine when remote deletion fails", async () => {
    let pendingCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          deleteRemoteSnapshots: async () => {
            throw new Error("network");
          },
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /network/
    );

    assert.equal(pendingCleared, false);
  });

  it("preserves local files and quarantine when the game starts after remote deletion", async () => {
    let checks = 0;
    let remoteDeleted = false;
    let localDeleted = false;
    let localStateCleared = false;
    let pendingCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          assertGameNotRunning: () => {
            checks += 1;
            if (checks === 2) {
              throw new Error("cloud_save_delete_game_running");
            }
          },
          deleteRemoteSnapshots: async () => {
            remoteDeleted = true;
          },
          runWithLocalDeletionSnapshot: (operation) =>
            operation({
              deleteLocalFiles: async () => {
                localDeleted = true;
              },
              clearLocalState: async () => {
                localStateCleared = true;
              },
            }),
          clearPendingDeletion: async () => {
            pendingCleared = true;
          },
        })
      ),
      /cloud_save_delete_game_running/
    );

    assert.equal(remoteDeleted, true);
    assert.equal(localDeleted, false);
    assert.equal(localStateCleared, false);
    assert.equal(pendingCleared, false);
  });

  it("keeps quarantine when local deletion or state cleanup fails", async () => {
    for (const failure of ["local-files", "local-state"] as const) {
      let pendingCleared = false;
      await assert.rejects(
        executeDeleteGameCloudSaveData(
          createDependencies({
            runWithLocalDeletionSnapshot: (operation) =>
              operation({
                deleteLocalFiles: async () => {
                  if (failure === "local-files") throw new Error(failure);
                },
                clearLocalState: async () => {
                  if (failure === "local-state") throw new Error(failure);
                },
              }),
            clearPendingDeletion: async () => {
              pendingCleared = true;
            },
          })
        ),
        new RegExp(failure)
      );
      assert.equal(pendingCleared, false);
    }
  });

  it("retries a recovered remote-started deletion and clears it after success", async () => {
    const calls: string[] = [];

    await executeDeleteGameCloudSaveData(
      createDependencies({
        beginPendingDeletion: async () => {
          calls.push("recover-remote-started");
          return "remote-started";
        },
        markRemoteDeletionStarted: async () => {
          calls.push("mark-remote-started");
        },
        deleteRemoteSnapshots: async () => {
          calls.push("delete-remote-again");
        },
        runWithLocalDeletionSnapshot: (operation) =>
          operation({
            deleteLocalFiles: async () => {
              calls.push("delete-local");
            },
            clearLocalState: async () => {
              calls.push("clear-local-state");
            },
          }),
        clearPendingDeletion: async () => {
          calls.push("clear-pending");
        },
      })
    );

    assert.deepEqual(calls, [
      "recover-remote-started",
      "mark-remote-started",
      "delete-remote-again",
      "delete-local",
      "clear-local-state",
      "clear-pending",
    ]);
  });

  it("keeps quarantine when its final cleanup fails", async () => {
    let localDeleted = false;
    let localStateCleared = false;

    await assert.rejects(
      executeDeleteGameCloudSaveData(
        createDependencies({
          runWithLocalDeletionSnapshot: (operation) =>
            operation({
              deleteLocalFiles: async () => {
                localDeleted = true;
              },
              clearLocalState: async () => {
                localStateCleared = true;
              },
            }),
          clearPendingDeletion: async () => {
            throw new Error("marker-cleanup");
          },
        })
      ),
      /marker-cleanup/
    );

    assert.equal(localDeleted, true);
    assert.equal(localStateCleared, true);
  });
});
