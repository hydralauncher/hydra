import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { SteamIntegrationStatus } from "@types";

import { createSteamStartupSync } from "./steam-startup-sync-core.js";

const connectedStatus = {
  connected: true,
  snapshotPreserved: false,
} as SteamIntegrationStatus;

describe("Steam startup sync", () => {
  it("starts exactly once while authenticated and connected", async () => {
    const startSync = mock.fn(async () => {});
    const startupSync = createSteamStartupSync({
      isLoggedIn: () => true,
      getStatus: async () => connectedStatus,
      startSync,
      logError: mock.fn(),
    });

    await Promise.all([startupSync.run(), startupSync.run()]);

    assert.equal(startSync.mock.callCount(), 1);
    assert.equal(
      (startSync.mock.calls[0]?.arguments as unknown[] | undefined)?.[0],
      "startup"
    );
  });

  it("waits for a late login", async () => {
    let loggedIn = false;
    const startSync = mock.fn(async () => {});
    const startupSync = createSteamStartupSync({
      isLoggedIn: () => loggedIn,
      getStatus: async () => connectedStatus,
      startSync,
      logError: mock.fn(),
    });

    await startupSync.run();
    loggedIn = true;
    await startupSync.run();
    await startupSync.run();

    assert.equal(startSync.mock.callCount(), 1);
  });

  it("does not start when Steam is disconnected", async () => {
    const startSync = mock.fn(async () => {});
    const startupSync = createSteamStartupSync({
      isLoggedIn: () => true,
      getStatus: async () => ({
        connected: false,
        snapshotPreserved: false,
      }),
      startSync,
      logError: mock.fn(),
    });

    await startupSync.run();
    await startupSync.run();

    assert.equal(startSync.mock.callCount(), 0);
  });

  it("allows a new attempt after sign-out reset", async () => {
    const startSync = mock.fn(async () => {});
    const startupSync = createSteamStartupSync({
      isLoggedIn: () => true,
      getStatus: async () => connectedStatus,
      startSync,
      logError: mock.fn(),
    });

    await startupSync.run();
    startupSync.reset();
    await startupSync.run();

    assert.equal(startSync.mock.callCount(), 2);
  });

  it("keeps API failures in the background", async () => {
    const logError = mock.fn();
    const startupSync = createSteamStartupSync({
      isLoggedIn: () => true,
      getStatus: async () => {
        throw new Error("offline");
      },
      startSync: mock.fn(async () => {}),
      logError,
    });

    await assert.doesNotReject(startupSync.run());
    assert.equal(logError.mock.callCount(), 1);
  });
});
