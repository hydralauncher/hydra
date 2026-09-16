import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSteamLibraryExecutablePath,
  resolveActiveSteamImport,
  resolveSteamSessionPlaytimePolicy,
  STEAM_PLAYTIME_LOOKUP_TIMEOUT_MS,
} from "./steam-playtime.js";

describe("Steam installation paths", () => {
  it("recognizes secondary Windows libraries with either separator and casing", () => {
    assert.equal(
      isSteamLibraryExecutablePath(
        "d:/steamlibrary/SteamApps/Common/Portal/bin/portal.exe",
        ["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"],
        "win32"
      ),
      true
    );
  });

  it("recognizes Linux and macOS executables, including nested app bundles", () => {
    assert.equal(
      isSteamLibraryExecutablePath(
        "/mnt/games/steamapps/common/Portal/portal",
        ["/mnt/games"],
        "linux"
      ),
      true
    );
    assert.equal(
      isSteamLibraryExecutablePath(
        "/Users/me/Library/Application Support/Steam/steamapps/common/Game/Game.app/Contents/MacOS/Game",
        ["/Users/me/Library/Application Support/Steam"],
        "darwin"
      ),
      true
    );
  });

  it("rejects sibling folders, traversal, other drives, and unregistered libraries", () => {
    for (const executable of [
      "D:\\SteamLibrary\\steamapps\\common-copy\\game.exe",
      "D:\\SteamLibrary\\steamapps\\common\\..\\game.exe",
      "D:\\SteamLibrary-copy\\steamapps\\common\\Game\\game.exe",
      "C:\\SteamLibrary\\steamapps\\common\\Game\\game.exe",
      "steamapps\\common\\Game\\game.exe",
      "D:\\SteamLibrary\\steamapps\\common",
    ]) {
      assert.equal(
        isSteamLibraryExecutablePath(executable, ["D:\\SteamLibrary"], "win32"),
        false,
        executable
      );
    }
    assert.equal(
      isSteamLibraryExecutablePath(
        "/Steam/steamapps/common/Game/game",
        ["/steam"],
        "linux"
      ),
      false
    );
    assert.equal(
      isSteamLibraryExecutablePath(
        "/steam/steamapps/common/Game/game",
        [],
        "linux"
      ),
      false
    );
  });
});

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
  it("keeps automatic deduplication for Steam library executables", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: true,
        isSteamLibraryPath: true,
        disableHydraPlaytimeTracking: false,
      }),
      { countHydraPlaytime: false, syncSteamOnExit: true }
    );
  });

  it("allows a per-game opt-out without scheduling an unrelated Steam sync", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: true,
        isSteamLibraryPath: false,
        disableHydraPlaytimeTracking: true,
      }),
      { countHydraPlaytime: false, syncSteamOnExit: false }
    );
  });

  it("ignores the preference after the Steam import is disconnected", () => {
    assert.deepEqual(
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: false,
        isSteamLibraryPath: false,
        disableHydraPlaytimeTracking: true,
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
        disableHydraPlaytimeTracking: true,
      }),
      { countHydraPlaytime: true, syncSteamOnExit: false }
    );
  });
});
