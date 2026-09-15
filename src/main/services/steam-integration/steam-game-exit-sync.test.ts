import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { SteamGameSyncPayload } from "@types";

import {
  createSteamGameExitSyncScheduler,
  shouldScheduleSteamGameExitSync,
} from "./steam-game-exit-sync-scheduler.js";

type Timer = { callback: () => void; delayMs: number; cancelled: boolean };

const payload = (playTimeInSeconds: number): SteamGameSyncPayload => ({
  playTimeInSeconds,
  lastPlayedAt: "2026-09-15T18:00:00.000Z",
  achievements: [
    {
      name: "ACH.WAKE_UP",
      unlockTime: "2026-09-15T17:00:00.000Z",
    },
  ],
});

const setup = (
  collectImpl: () => Promise<SteamGameSyncPayload> = async () => payload(600)
) => {
  const timers: Timer[] = [];
  const publish = mock.fn(async () => {});
  const collect = mock.fn(collectImpl);
  const waitForFullSync = mock.fn(async () => {});
  const logError = mock.fn();
  const scheduler = createSteamGameExitSyncScheduler({
    waitForFullSync,
    collect,
    publish,
    scheduleTimer: ((callback: () => void, delayMs: number) => {
      const timer = { callback, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    }) as unknown as typeof setTimeout,
    clearTimer: ((timer: Timer) => {
      timer.cancelled = true;
    }) as unknown as typeof clearTimeout,
    log: mock.fn(),
    logError,
  });

  return { timers, publish, collect, waitForFullSync, logError, scheduler };
};

describe("Steam game exit sync", () => {
  it("runs only for protected Steam sessions", () => {
    assert.equal(shouldScheduleSteamGameExitSync("steam", false), true);
    assert.equal(shouldScheduleSteamGameExitSync("steam", true), false);
    assert.equal(shouldScheduleSteamGameExitSync("custom", false), false);
  });

  it("schedules collection at 10 and 30 seconds", () => {
    const { timers, scheduler } = setup();

    scheduler.schedule("steam:620", "620");

    assert.deepEqual(
      timers.map((timer) => timer.delayMs),
      [10_000, 30_000]
    );
  });

  it("always collects twice but skips an unchanged second publish", async () => {
    const { timers, publish, collect, waitForFullSync, scheduler } = setup();
    scheduler.schedule("steam:620", "620");

    timers[0].callback();
    await scheduler.waitForPending("steam:620");
    timers[1].callback();
    await scheduler.waitForPending("steam:620");

    assert.equal(waitForFullSync.mock.callCount(), 2);
    assert.equal(collect.mock.callCount(), 2);
    assert.equal(publish.mock.callCount(), 1);
  });

  it("publishes the second attempt when data changed", async () => {
    let playtime = 600;
    const { timers, publish, scheduler } = setup(async () => {
      const current = payload(playtime);
      playtime = 900;
      return current;
    });
    scheduler.schedule("steam:620", "620");

    timers[0].callback();
    await scheduler.waitForPending("steam:620");
    timers[1].callback();
    await scheduler.waitForPending("steam:620");

    assert.equal(publish.mock.callCount(), 2);
  });

  it("publishes the second attempt after the first fails", async () => {
    let attempt = 0;
    const { timers, publish, scheduler } = setup(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("Steam still updating");
      return payload(600);
    });
    scheduler.schedule("steam:620", "620");

    timers[0].callback();
    await scheduler.waitForPending("steam:620");
    timers[1].callback();
    await scheduler.waitForPending("steam:620");

    assert.equal(publish.mock.callCount(), 1);
  });

  it("starts the second collection even while the first is pending", async () => {
    let finishFirst: ((payload: SteamGameSyncPayload) => void) | undefined;
    let attempt = 0;
    const { timers, collect, scheduler } = setup(() => {
      attempt += 1;
      if (attempt === 1) {
        return new Promise((resolve) => {
          finishFirst = resolve;
        });
      }
      return Promise.resolve(payload(900));
    });
    scheduler.schedule("steam:620", "620");

    timers[0].callback();
    await Promise.resolve();
    timers[1].callback();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(collect.mock.callCount(), 2);
    finishFirst?.(payload(600));
    await scheduler.waitForPending("steam:620");
  });

  it("cancels old attempts when the game reopens", async () => {
    const { timers, publish, scheduler } = setup();
    scheduler.schedule("steam:620", "620");

    scheduler.cancel("steam:620");
    for (const timer of timers) {
      if (!timer.cancelled) timer.callback();
    }
    await scheduler.waitForPending("steam:620");

    assert.equal(
      timers.every((timer) => timer.cancelled),
      true
    );
    assert.equal(publish.mock.callCount(), 0);
  });

  it("does not publish an in-flight collection after reopening", async () => {
    let finishCollection: ((payload: SteamGameSyncPayload) => void) | undefined;
    const { timers, publish, scheduler } = setup(
      () =>
        new Promise((resolve) => {
          finishCollection = resolve;
        })
    );
    scheduler.schedule("steam:620", "620");

    timers[0].callback();
    await Promise.resolve();
    scheduler.cancel("steam:620");
    finishCollection?.(payload(600));
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(publish.mock.callCount(), 0);
  });
});
