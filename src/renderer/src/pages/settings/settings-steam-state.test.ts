import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getSteamIntegrationViewState } from "./settings-steam-state.ts";

const connectedIntegration = {
  connected: true as const,
  snapshotPreserved: false as const,
  steamId64: "76561198000000000",
  username: "hydra",
  avatarUrl: null,
  connectedAt: "2026-09-16T12:00:00.000Z",
  disconnectedAt: null,
  lastSyncedAt: null,
  latestSyncRun: null,
};

describe("getSteamIntegrationViewState", () => {
  it("uses one reconnect state for an expired Steam session", () => {
    assert.equal(
      getSteamIntegrationViewState(connectedIntegration, {
        status: "idle",
        requiresReconnect: true,
      }),
      "reconnect-required"
    );
  });

  it("keeps a connected status during regular and active sync states", () => {
    assert.equal(
      getSteamIntegrationViewState(connectedIntegration, { status: "idle" }),
      "connected"
    );
    assert.equal(
      getSteamIntegrationViewState(connectedIntegration, {
        status: "running",
        syncRunId: "sync-run",
        phase: "library",
        gamesFound: 0,
        gamesProcessed: 0,
      }),
      "connected"
    );
  });

  it("distinguishes preserved snapshots from disconnected accounts", () => {
    assert.equal(
      getSteamIntegrationViewState(
        {
          ...connectedIntegration,
          connected: false,
          snapshotPreserved: true,
        },
        { status: "idle" }
      ),
      "snapshot-preserved"
    );
    assert.equal(
      getSteamIntegrationViewState(
        { connected: false, snapshotPreserved: false },
        { status: "idle" }
      ),
      "disconnected"
    );
  });
});
