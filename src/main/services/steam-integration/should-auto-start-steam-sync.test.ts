import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { shouldAutoStartSteamSync } from "./should-auto-start-steam-sync.ts";

describe("shouldAutoStartSteamSync", () => {
  it("resumes a PENDING run while the local orchestrator is idle", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: "2026-09-08T12:00:00.000Z",
        latestSyncRunStatus: "PENDING",
        localOrchestratorIdle: true,
      }),
      true
    );
  });

  it("starts when Steam is connected and has never synced", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: null,
        latestSyncRunStatus: null,
        localOrchestratorIdle: true,
      }),
      true
    );
  });

  it("does not auto-retry a FAILED run", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: null,
        latestSyncRunStatus: "FAILED",
        localOrchestratorIdle: true,
      }),
      false
    );
  });

  it("does not start while a run is RUNNING on the API", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: null,
        latestSyncRunStatus: "RUNNING",
        localOrchestratorIdle: true,
      }),
      false
    );
  });

  it("does not start while the local orchestrator is busy", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: null,
        latestSyncRunStatus: "PENDING",
        localOrchestratorIdle: false,
      }),
      false
    );
  });

  it("does not start when Steam is disconnected", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: false,
        lastSyncedAt: null,
        latestSyncRunStatus: "PENDING",
        localOrchestratorIdle: true,
      }),
      false
    );
  });

  it("does not start after a successful sync", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: "2026-09-08T12:00:00.000Z",
        latestSyncRunStatus: "SUCCEEDED",
        localOrchestratorIdle: true,
      }),
      false
    );
  });
});
