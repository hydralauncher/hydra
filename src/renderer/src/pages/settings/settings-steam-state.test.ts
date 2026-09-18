import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getSteamIntegrationPresentation } from "./settings-steam-state.ts";

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
    assert.deepEqual(
      getSteamIntegrationPresentation(connectedIntegration, {
        status: "idle",
        requiresReconnect: true,
      }),
      {
        viewState: "reconnect-required",
        statusKey: "steam_status_reconnect_required",
        statusTone: "warning",
      }
    );
  });

  it("keeps a connected status during regular and active sync states", () => {
    assert.equal(
      getSteamIntegrationPresentation(connectedIntegration, { status: "idle" })
        .viewState,
      "connected"
    );
    assert.equal(
      getSteamIntegrationPresentation(connectedIntegration, {
        status: "running",
        syncRunId: "sync-run",
        phase: "library",
        gamesFound: 0,
        gamesProcessed: 0,
      }).viewState,
      "connected"
    );
  });

  it("distinguishes preserved snapshots from disconnected accounts", () => {
    assert.equal(
      getSteamIntegrationPresentation(
        {
          ...connectedIntegration,
          connected: false,
          snapshotPreserved: true,
        },
        { status: "idle" }
      ).viewState,
      "snapshot-preserved"
    );
    assert.equal(
      getSteamIntegrationPresentation(
        { connected: false, snapshotPreserved: false },
        { status: "idle" }
      ).viewState,
      "disconnected"
    );
  });
});
