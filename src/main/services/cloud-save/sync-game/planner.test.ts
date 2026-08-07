import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  planCloudSaveSync,
  requireCommittedCloudSaveSnapshot,
} from "./planner.ts";

const input = (
  overrides: Partial<Parameters<typeof planCloudSaveSync>[0]> = {}
): Parameters<typeof planCloudSaveSync>[0] => ({
  trigger: "manual",
  initialState: "synced",
  firstSyncState: "synced",
  gameRunning: false,
  hasLocalFiles: true,
  hasRemoteSnapshot: true,
  hasConflicts: false,
  proposalChanged: false,
  restoreEntryCount: 0,
  deleteLocalEntryCount: 0,
  ...overrides,
});

describe("cloud save sync planner", () => {
  it("blocks every sync while the game is running", () => {
    const result = planCloudSaveSync(input({ gameRunning: true }));

    assert.deepEqual(result, {
      kind: "blocked",
      action: "none",
      execution: "none",
      reason: "game-running",
    });
  });

  it("keeps conflict decisions in the main-process planner", () => {
    const result = planCloudSaveSync(input({ hasConflicts: true }));

    assert.equal(result.kind, "conflict");
    assert.equal(result.execution, "none");
  });

  it("restores an empty local snapshot for every sync direction", () => {
    for (const trigger of [
      "manual",
      "game-page-open",
      "environment-changed",
      "pre-launch",
      "post-exit",
    ] as const) {
      const result = planCloudSaveSync(
        input({
          trigger,
          hasLocalFiles: false,
          restoreEntryCount: 1,
        })
      );

      assert.equal(result.kind, "restore", trigger);
      assert.equal(result.execution, "restore-only", trigger);
    }
  });

  it("does nothing when an empty local snapshot has no applicable restore", () => {
    assert.equal(
      planCloudSaveSync(input({ hasLocalFiles: false, restoreEntryCount: 0 }))
        .kind,
      "noop"
    );
  });

  it("uploads a first local snapshot except during restore-only flows", () => {
    assert.equal(
      planCloudSaveSync(
        input({
          initialState: "untracked",
          firstSyncState: "local-ahead",
          hasRemoteSnapshot: false,
          proposalChanged: true,
        })
      ).kind,
      "upload"
    );
    assert.equal(
      planCloudSaveSync(
        input({
          trigger: "pre-launch",
          initialState: "untracked",
          firstSyncState: "local-ahead",
          hasRemoteSnapshot: false,
          proposalChanged: true,
        })
      ).kind,
      "noop"
    );
  });

  it("distinguishes upload, restore and merge after the first sync", () => {
    assert.equal(
      planCloudSaveSync(input({ proposalChanged: true })).kind,
      "upload"
    );
    assert.equal(
      planCloudSaveSync(input({ restoreEntryCount: 1 })).kind,
      "restore"
    );
    assert.equal(
      planCloudSaveSync(input({ proposalChanged: true, restoreEntryCount: 1 }))
        .kind,
      "merge"
    );
  });

  it("keeps post-exit local-only while still publishing its proposal", () => {
    const result = planCloudSaveSync(
      input({
        trigger: "post-exit",
        proposalChanged: true,
        restoreEntryCount: 1,
      })
    );

    assert.equal(result.kind, "upload");
    assert.equal(result.execution, "apply");
  });

  it("never accepts a reported upload without a committed snapshot", () => {
    assert.throws(
      () => requireCommittedCloudSaveSnapshot(null),
      /cloud_save_snapshot_not_committed/
    );
    const snapshot = { id: "snapshot" };
    assert.equal(requireCommittedCloudSaveSnapshot(snapshot), snapshot);
  });
});
