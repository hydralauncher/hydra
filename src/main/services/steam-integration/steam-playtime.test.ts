import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveActiveSteamImport,
  resolveSteamSessionPlaytimePolicy,
  STEAM_PLAYTIME_LOOKUP_TIMEOUT_MS,
} from "./steam-playtime.js";

describe("Steam import lookup", () => {
  it("uses the server's current link instead of the cached value", async () => {
    assert.equal(
      await resolveActiveSteamImport(false, async () => ({
        hasActiveSteamImport: true,
      })),
      true
    );
    assert.equal(
      await resolveActiveSteamImport(true, async () => ({
        hasActiveSteamImport: false,
      })),
      false
    );
    assert.equal(await resolveActiveSteamImport(true, async () => ({})), false);
  });

  it("keeps the last known link offline, defaulting to normal Hydra counting", async () => {
    const offline = async () => {
      throw new Error("offline");
    };
    assert.equal(await resolveActiveSteamImport(true, offline), true);
    assert.equal(await resolveActiveSteamImport(false, offline), false);
    assert.equal(await resolveActiveSteamImport(undefined, offline), false);
  });

  it("stops waiting after three seconds even if the request ignores abort", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let signal: AbortSignal | undefined;
    let finish:
      | ((status: { hasActiveSteamImport: boolean }) => void)
      | undefined;
    const result = resolveActiveSteamImport(true, (requestSignal) => {
      signal = requestSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    t.mock.timers.tick(STEAM_PLAYTIME_LOOKUP_TIMEOUT_MS);
    assert.equal(await result, true);
    assert.equal(signal?.aborted, true);
    finish?.({ hasActiveSteamImport: false });
    assert.equal(await result, true);
  });
});

describe("Steam session playtime policy", () => {
  it("deduplicates imported Steam library sessions and syncs on exit", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: true,
        isSteamLibraryPath: true,
        enableHydraPlaytimeTracking: false,
      }),
      { countHydraPlaytime: false, syncSteamOnExit: true }
    );
  });

  it("counts imported games launched from outside Steam libraries", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: true,
        isSteamLibraryPath: false,
        enableHydraPlaytimeTracking: false,
      }),
      { countHydraPlaytime: true, syncSteamOnExit: false }
    );
  });

  it("allows an imported game to opt in without changing exit sync eligibility", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: true,
        isSteamLibraryPath: true,
        enableHydraPlaytimeTracking: true,
      }),
      { countHydraPlaytime: true, syncSteamOnExit: true }
    );

    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: true,
        isSteamLibraryPath: false,
        enableHydraPlaytimeTracking: true,
      }),
      { countHydraPlaytime: true, syncSteamOnExit: false }
    );
  });

  it("counts Hydra playtime after the Steam import is disconnected", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: false,
        isSteamLibraryPath: false,
        enableHydraPlaytimeTracking: false,
      }),
      { countHydraPlaytime: true, syncSteamOnExit: false }
    );
  });

  it("counts an outside-library launch after a cached import is revalidated as disconnected", async () => {
    const hasActiveSteamImport = await resolveActiveSteamImport(
      true,
      async () => ({ hasActiveSteamImport: false })
    );

    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport,
        isSteamLibraryPath: false,
        enableHydraPlaytimeTracking: false,
      }),
      { countHydraPlaytime: true, syncSteamOnExit: false }
    );
  });
});
