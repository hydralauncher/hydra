import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { shouldAutoStartSteamSync } from "../../../shared/should-auto-start-steam-sync.ts";

describe("shouldAutoStartSteamSync", () => {
  it("resumes a PENDING run while the local orchestrator is idle", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: "2026-09-08T12:00:00.000Z",
        latestSyncRunStatus: "PENDING",
        localOrchestratorIdle: true,
        requiresReconnect: false,
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
        requiresReconnect: false,
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
        requiresReconnect: false,
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
        requiresReconnect: false,
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
        requiresReconnect: false,
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
        requiresReconnect: false,
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
        requiresReconnect: false,
      }),
      false
    );
  });

  it("does not retry after the local Steam session requires reconnect", () => {
    assert.equal(
      shouldAutoStartSteamSync({
        connected: true,
        lastSyncedAt: null,
        latestSyncRunStatus: null,
        localOrchestratorIdle: true,
        requiresReconnect: true,
      }),
      false
    );
  });
});
