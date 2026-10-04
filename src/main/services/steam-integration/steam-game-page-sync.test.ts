import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { SteamGameSyncPayload } from "@types";

import {
  createSteamGamePageSync,
  shouldSyncSteamGameOnGamePage,
} from "./steam-game-page-sync-core.js";

const payload: SteamGameSyncPayload = {
  playTimeInSeconds: 600,
  lastPlayedAt: "2026-09-17T18:00:00.000Z",
  achievements: [],
};

const setup = ({
  waitForFullSync = async () => {},
  collect = async () => payload,
}: {
  waitForFullSync?: () => Promise<void>;
  collect?: (steamAppId: string) => Promise<SteamGameSyncPayload>;
} = {}) => {
  const publish = mock.fn(
    async (
      _steamAppId: string,
      _payload: SteamGameSyncPayload,
      _signal: AbortSignal
    ) => {}
  );
  const collectMock = mock.fn(collect);
  const waitForFullSyncMock = mock.fn(waitForFullSync);
  const logError = mock.fn();
  const pageSync = createSteamGamePageSync({
    waitForFullSync: waitForFullSyncMock,
    collect: (steamAppId) => collectMock(steamAppId),
    publish,
    log: mock.fn(),
    logError,
  });

  return {
    pageSync,
    publish,
    collect: collectMock,
    waitForFullSync: waitForFullSyncMock,
    logError,
  };
};

describe("Steam game page sync", () => {
  it("accepts only visible games with an active import while logged in", () => {
    assert.equal(
      shouldSyncSteamGameOnGamePage(true, {
        hasActiveSteamImport: true,
        isDeleted: false,
      }),
      true
    );
    assert.equal(
      shouldSyncSteamGameOnGamePage(false, {
        hasActiveSteamImport: true,
      }),
      false
    );
    assert.equal(
      shouldSyncSteamGameOnGamePage(true, {
        hasActiveSteamImport: false,
      }),
      false
    );
    assert.equal(
      shouldSyncSteamGameOnGamePage(true, {
        hasActiveSteamImport: true,
        isDeleted: true,
      }),
      false
    );
    assert.equal(shouldSyncSteamGameOnGamePage(true, null), false);
  });

  it("waits for a full sync before collecting and publishing one game", async () => {
    const calls: string[] = [];
    let finishFullSync!: () => void;
    const fullSync = new Promise<void>((resolve) => {
      finishFullSync = resolve;
    });
    const { pageSync, collect, publish } = setup({
      waitForFullSync: async () => {
        calls.push("wait");
        await fullSync;
      },
      collect: async (steamAppId) => {
        calls.push(`collect:${steamAppId}`);
        return payload;
      },
    });
    publish.mock.mockImplementation(async (steamAppId) => {
      calls.push(`publish:${steamAppId}`);
    });

    const result = pageSync.sync("620");
    await Promise.resolve();
    assert.deepEqual(calls, ["wait"]);

    finishFullSync();
    assert.equal(await result, true);
    assert.deepEqual(calls, ["wait", "collect:620", "publish:620"]);
    assert.equal(collect.mock.callCount(), 1);
    assert.equal(publish.mock.callCount(), 1);
  });

  it("coalesces concurrent requests for the same game", async () => {
    let finishCollection!: (value: SteamGameSyncPayload) => void;
    const { pageSync, collect, publish } = setup({
      collect: () =>
        new Promise((resolve) => {
          finishCollection = resolve;
        }),
    });

    const first = pageSync.sync("620");
    const second = pageSync.sync("620");

    assert.equal(first, second);
    await Promise.resolve();
    finishCollection(payload);
    assert.equal(await first, true);
    assert.equal(collect.mock.callCount(), 1);
    assert.equal(publish.mock.callCount(), 1);
  });

  it("syncs again after the previous page request finishes", async () => {
    const { pageSync, collect, publish } = setup();

    assert.equal(await pageSync.sync("620"), true);
    assert.equal(await pageSync.sync("620"), true);

    assert.equal(collect.mock.callCount(), 2);
    assert.equal(publish.mock.callCount(), 2);
  });

  it("releases the request after failure so a later page open can retry", async () => {
    let attempt = 0;
    const { pageSync, collect, publish, logError } = setup({
      collect: async () => {
        attempt += 1;
        if (attempt === 1) throw new Error("offline");
        return payload;
      },
    });

    assert.equal(await pageSync.sync("620"), false);
    assert.equal(await pageSync.sync("620"), true);

    assert.equal(collect.mock.callCount(), 2);
    assert.equal(publish.mock.callCount(), 1);
    assert.equal(logError.mock.callCount(), 1);
  });

  it("keeps simultaneous requests for different games independent", async () => {
    const { pageSync, collect, publish } = setup();

    assert.deepEqual(
      await Promise.all([pageSync.sync("620"), pageSync.sync("220")]),
      [true, true]
    );
    assert.deepEqual(
      collect.mock.calls.map((call) => call.arguments[0]).sort(),
      ["220", "620"]
    );
    assert.equal(publish.mock.callCount(), 2);
  });
});
