import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveCustomPathApproval,
  CloudSaveSyncTrigger,
  SyncGameCloudSaveResult,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { runCloudSaveModalSyncFlow } from "./cloud-save-modal-sync-flow.ts";

const approval = (
  id: string,
  rawPath = `<custom><windows><winDocuments>/${id}`
): CloudSaveCustomPathApproval => ({
  id,
  gameId: { shop: "steam", objectId: "game" },
  purpose: "manual-sync",
  rawPath,
  suggestedPath: `C:\\Saves\\${id}`,
  selectedPath: `C:\\Saves\\${id}`,
  canUseSuggestedPath: true,
  fileCount: 1,
  totalSizeBytes: 10,
  files: [],
  snapshotId: "snapshot",
  snapshotVersion: 1,
});

const syncResult = (
  trigger: CloudSaveSyncTrigger,
  finalState: SyncGameCloudSaveResult["finalState"] = "synced"
): SyncGameCloudSaveResult => ({
  trigger,
  action: trigger === "custom-path-rebind" ? "restore" : "none",
  initialState: "remote-ahead",
  finalState,
});

describe("cloud save modal sync flow", () => {
  it("runs the regular manual sync when no approval is required", async () => {
    const calls: string[] = [];

    const result = await runCloudSaveModalSyncFlow(null, {
      confirmApproval: async () => {
        calls.push("confirm");
      },
      getContext: async () => {
        calls.push("context");
        return {};
      },
      createApproval: async () => {
        calls.push("inspect");
        return null;
      },
      completeApproval: async () => {
        calls.push("complete");
      },
      sync: async (trigger) => {
        calls.push(`sync:${trigger}`);
        return syncResult(trigger);
      },
    });

    assert.equal(result.status, "completed");
    assert.deepEqual(calls, ["context", "inspect", "sync:manual"]);
  });

  it("returns an approval before starting any sync", async () => {
    const pending = approval("first");
    const syncs: string[] = [];

    const result = await runCloudSaveModalSyncFlow(null, {
      confirmApproval: async () => undefined,
      getContext: async () => ({}),
      createApproval: async () => pending,
      completeApproval: async () => undefined,
      sync: async (trigger) => {
        syncs.push(trigger);
        return syncResult(trigger);
      },
    });

    assert.deepEqual(result, {
      status: "approval-required",
      approval: pending,
    });
    assert.deepEqual(syncs, []);
  });

  it("returns the next approval without syncing between destinations", async () => {
    const calls: string[] = [];
    const next = approval("second");

    const result = await runCloudSaveModalSyncFlow("first", {
      confirmApproval: async (id) => {
        calls.push(`confirm:${id}`);
      },
      getContext: async () => {
        calls.push("context");
        return {};
      },
      createApproval: async () => {
        calls.push("inspect");
        return next;
      },
      completeApproval: async () => {
        calls.push("complete");
      },
      sync: async (trigger) => {
        calls.push(`sync:${trigger}`);
        return syncResult(trigger);
      },
    });

    assert.deepEqual(result, {
      status: "approval-required",
      approval: next,
    });
    assert.deepEqual(calls, ["confirm:first", "context", "inspect"]);
  });

  it("restores safely before continuing the requested manual sync", async () => {
    const calls: string[] = [];
    let inspections = 0;

    const result = await runCloudSaveModalSyncFlow("last", {
      confirmApproval: async (id) => {
        calls.push(`confirm:${id}`);
      },
      getContext: async () => {
        calls.push("context");
        return { generation: calls.length };
      },
      createApproval: async (_context, preserveApprovalId) => {
        calls.push(`inspect:${preserveApprovalId}`);
        inspections += 1;
        return null;
      },
      completeApproval: async (id) => {
        calls.push(`complete:${id}`);
      },
      sync: async (trigger) => {
        calls.push(`sync:${trigger}`);
        return syncResult(trigger);
      },
    });

    assert.equal(result.status, "completed");
    assert.equal(inspections, 2);
    assert.deepEqual(calls, [
      "confirm:last",
      "context",
      "inspect:last",
      "sync:custom-path-rebind",
      "context",
      "inspect:last",
      "sync:manual",
      "complete:last",
    ]);
  });

  it("prompts again when a new destination appears after the safe restore", async () => {
    const newlyDiscovered = approval("new");
    let inspections = 0;
    const syncs: string[] = [];

    const result = await runCloudSaveModalSyncFlow("last", {
      confirmApproval: async () => undefined,
      getContext: async () => ({}),
      createApproval: async () => {
        inspections += 1;
        return inspections === 2 ? newlyDiscovered : null;
      },
      completeApproval: async () => undefined,
      sync: async (trigger) => {
        syncs.push(trigger);
        return syncResult(trigger);
      },
    });

    assert.deepEqual(result, {
      status: "approval-required",
      approval: newlyDiscovered,
    });
    assert.deepEqual(syncs, ["custom-path-rebind"]);
  });

  it("stops before bidirectional sync when the safe restore conflicts", async () => {
    const syncs: string[] = [];
    const completed: string[] = [];

    const result = await runCloudSaveModalSyncFlow("last", {
      confirmApproval: async () => undefined,
      getContext: async () => ({}),
      createApproval: async () => null,
      completeApproval: async (id) => {
        completed.push(id);
      },
      sync: async (trigger) => {
        syncs.push(trigger);
        return syncResult(trigger, "conflict");
      },
    });

    assert.equal(result.status, "completed");
    assert.deepEqual(syncs, ["custom-path-rebind"]);
    assert.deepEqual(completed, ["last"]);
  });

  it("does not continue or complete the approval when safe restore fails", async () => {
    const syncs: string[] = [];
    const completed: string[] = [];

    await assert.rejects(
      runCloudSaveModalSyncFlow("last", {
        confirmApproval: async () => undefined,
        getContext: async () => ({}),
        createApproval: async () => null,
        completeApproval: async (id) => {
          completed.push(id);
        },
        sync: async (trigger) => {
          syncs.push(trigger);
          throw new Error("restore failed");
        },
      }),
      /restore failed/
    );

    assert.deepEqual(syncs, ["custom-path-rebind"]);
    assert.deepEqual(completed, []);
  });
});
