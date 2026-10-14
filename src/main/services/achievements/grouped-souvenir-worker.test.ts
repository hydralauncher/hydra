import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import type { PendingAchievementSouvenir, User } from "@types";
import * as policy from "./grouped-souvenir-retry-policy.js";
import * as payload from "./grouped-souvenir-payload.js";
import * as syncStatus from "./grouped-souvenir-sync-status.js";
import * as syncItem from "./grouped-souvenir-sync-item.js";
import { composeAssetsWithArtwork } from "../../../shared/artwork-resolver.js";

const RETENTION_MS = 7 * 24 * 60 * 60_000;
const noop = () => undefined;
const errorResponse = (message: string, status = 404, clientId?: string) => ({
  isAxiosError: true,
  response: { status, data: { message, ...(clientId && { clientId }) } },
});
const pending = (
  overrides: Partial<PendingAchievementSouvenir> = {}
): PendingAchievementSouvenir => ({
  clientId: "client-1",
  ownerId: "owner",
  remoteGameId: "remote",
  gameKey: "steam:game",
  screenshotPath: "/fixture/photo.jpeg",
  capturedAt: 1,
  achievements: [{ name: "FIRST", unlockTime: 1 }],
  status: "pending",
  attemptCount: 0,
  ...overrides,
});

function fixture(records = [pending()]) {
  const store = new Map(
    records.map((record) => [record.clientId, structuredClone(record)])
  );
  const calls: string[] = [];
  const removed: string[] = [];
  const timers = new Set<{ delay: number; unref: () => void }>();
  const state = {
    now: 1_800_000_000_000,
    authorizationError: undefined as unknown,
    onAuthorize: undefined as (() => Promise<void>) | undefined,
    syncError: undefined as unknown,
    deleted: false,
    loggedIn: true,
    active: true,
    fresh: null as User | null,
    user: { id: "owner", subscription: null } as User,
  };
  const saved = (id = "client-1") => store.get(id)!;
  const response = {
    shop: "steam",
    objectId: "game",
    achievements: [],
    souvenirs: [{ clientId: "client-1", id: "souvenir-1" }],
  };
  const modules: Record<string, unknown> = {
    "node:fs": {
      promises: {
        rm: async (path: string) => {
          removed.push(path);
        },
      },
    },
    "@main/constants": {
      SOUVENIR_RETRY_BASE_DELAY_MS: 10_000,
      SOUVENIR_RETRY_MAX_DELAY_MS: 15 * 60_000,
      SOUVENIR_TERMINAL_RETENTION_MS: RETENTION_MS,
    },
    "@main/level": {
      db: { get: async () => state.user },
      gamesShopAssetsSublevel: { get: async () => null },
      gamesArtworkSelectionSublevel: { get: async () => null },
      gamesSublevel: {
        get: async () => ({
          title: "Game",
          iconUrl: "local:game-icon.png",
          shop: "steam",
          objectId: "game",
          isDeleted: state.deleted,
        }),
      },
      levelKeys: { user: "user" },
    },
    "@shared": { composeAssetsWithArtwork },
    "@main/events/user/get-unlocked-achievements": {
      getUnlockedAchievements: async () => null,
    },
    "../hydra-api": {
      HydraApi: {
        isLoggedIn: () => state.loggedIn,
        hasActiveSubscription: () => state.active,
        put: async () => {
          calls.push("sync");
          if (state.syncError) throw state.syncError;
          return response;
        },
      },
    },
    "../logger": {
      achievementsLogger: { info: noop, warn: noop, error: noop },
    },
    "../screenshot": {
      ScreenshotService: { cleanupOldScreenshots: async () => {} },
    },
    "../window-manager": { WindowManager: { sendToAppWindows: noop } },
    "./achievement-image-service": {
      AchievementImageService: {
        authorizeAchievementImage: async () => {
          calls.push("authorize");
          const error = state.authorizationError;
          await state.onAuthorize?.();
          if (error) throw error;
          return {
            authorization: {
              imageKey: "image",
              status: "pending",
              presignedUrl: "local",
            },
            image: Buffer.from("photo"),
          };
        },
        uploadAuthorizedAchievementImage: async () => {
          calls.push("upload");
        },
      },
    },
    "./achievement-memory-store": {
      AchievementMemoryStore: { get: () => null, set: noop },
    },
    "./achievement-souvenir-store": {
      AchievementSouvenirStore: { invalidate: noop },
    },
    "./grouped-souvenir-store": {
      PendingGroupedSouvenirStore: {
        get: async (id: string) => store.get(id),
        put: async (record: PendingAchievementSouvenir) => {
          store.set(record.clientId, structuredClone(record));
        },
        delete: async (id: string) => {
          store.delete(id);
        },
        list: async () =>
          [...store.values()].map((record) => structuredClone(record)),
        acknowledge: async (record: PendingAchievementSouvenir) => {
          store.delete(record.clientId);
        },
      },
      LocalSouvenirAssetStore: {},
    },
    "./grouped-souvenir-retry-policy": policy,
    "./grouped-souvenir-sync-status": syncStatus,
    "./get-game-achievement-data": {
      getGameAchievementData: async () => {
        calls.push("catalogue");
        return [
          {
            name: "FIRST",
            displayName: "First steps",
            icon: "local:achievement.png",
          },
        ];
      },
    },
    "./grouped-souvenir-sync-item": syncItem,
    "./merge-unlocked-achievements": {
      mergeUnlockedAchievementLists: (value: unknown) => value,
    },
    "./grouped-souvenir-payload": payload,
    "../user/get-user-data": {
      getUserData: async (options: unknown) => {
        calls.push("refresh");
        assert.deepEqual(options, {
          allowCached: false,
          triggerSouvenirSync: false,
        });
        return state.fresh;
      },
    },
  };
  const compiled = ts.transpileModule(
    fs.readFileSync(
      new URL("./grouped-souvenir-worker.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  function restart() {
    const exports = {};
    vm.compileFunction(compiled, [
      "exports",
      "require",
      "Date",
      "setTimeout",
      "clearTimeout",
    ])(
      exports,
      (name: string) =>
        modules[name] ??
        (name === "node:crypto"
          ? { randomUUID: () => "rotated" }
          : assert.fail(name)),
      class extends Date {
        static now() {
          return state.now;
        }
      },
      (_callback: unknown, delay: number) => {
        const timer = { delay, unref: noop };
        timers.add(timer);
        return timer;
      },
      (timer: { delay: number; unref: () => void }) => {
        timers.delete(timer);
      }
    );
    return exports as typeof import("./grouped-souvenir-worker");
  }
  const settle = async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const worker = restart();
  const run = async () => {
    await worker.groupedSouvenirWorker.trigger();
    await settle();
  };
  return {
    store,
    calls,
    removed,
    timers,
    state,
    saved,
    worker,
    restart,
    settle,
    run,
  };
}

describe("grouped souvenir worker recovery", () => {
  it("loads cleanup metadata once per game after restart and excludes another owner's records", async () => {
    const f = fixture([
      pending({ clientId: "older", capturedAt: 1 }),
      pending({ clientId: "newer", capturedAt: 2, status: "paused" }),
      pending({ clientId: "other", ownerId: "other-owner" }),
    ]);
    const details = await f.worker.getAchievementSouvenirSyncDetails();
    assert.deepEqual(f.calls, ["catalogue"]);
    assert.deepEqual(
      details.items.map((item) => item.clientId),
      ["newer", "older"]
    );
    assert.equal(details.items[0].gameIconUrl, "local:game-icon.png");
    assert.deepEqual(details.items[0].achievements, [
      {
        name: "FIRST",
        displayName: "First steps",
        iconUrl: "local:achievement.png",
      },
    ]);
  });
  it("stops a missing-game upload without achievement-only recovery, including after restart", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse(
      "achievements/souvenir-not-found"
    );
    await f.run();
    assert.deepEqual(f.calls, ["authorize"]);
    assert.equal(f.saved().status, "terminal");
    assert.equal(f.saved().recoveryMode, undefined);
    f.state.now += 15 * 60_000;
    f.worker.groupedSouvenirWorker.stop();
    const restarted = f.restart();
    await restarted.groupedSouvenirWorker.trigger();
    await f.settle();
    assert.deepEqual(f.calls, ["authorize"]);
    assert.deepEqual(f.removed, []);
    restarted.groupedSouvenirWorker.stop();
  });

  it("stops when the game is deleted between authorization and synchronization", async () => {
    const f = fixture();
    f.state.syncError = errorResponse("game/not-found");
    await f.run();
    assert.equal(f.saved().status, "terminal");
    assert.deepEqual(f.calls, ["authorize", "upload", "sync"]);
    f.state.now += 15 * 60_000;
    await f.run();
    assert.equal(f.calls.length, 3);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("terminates an old achievement-only recovery record on game/not-found", async () => {
    const f = fixture([pending({ recoveryMode: "sync_achievements_only" })]);
    f.state.syncError = errorResponse("game/not-found");
    await f.run();
    assert.deepEqual(f.calls, ["sync"]);
    assert.equal(f.saved().status, "terminal");
    assert.equal(f.saved().recoveryMode, undefined);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("skips locally deleted pending and paused items before making requests", async () => {
    const f = fixture([
      pending(),
      pending({ clientId: "paused", status: "paused" }),
    ]);
    f.state.deleted = true;
    await f.run();
    assert.deepEqual(f.calls, []);
    for (const record of f.store.values()) {
      assert.equal(record.status, "terminal");
      assert.equal(record.attemptCount, 0);
    }
    f.worker.groupedSouvenirWorker.stop();
  });

  it("retains terminal screenshots for seven days, then removes the file and record", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse(
      "achievements/souvenir-not-found"
    );
    await f.run();
    const failedAt = f.saved().lastAttemptAt!;
    f.state.now = failedAt + RETENTION_MS - 1;
    await f.run();
    assert.equal(f.store.size, 1);
    f.state.now += 1;
    await f.run();
    assert.equal(f.store.size, 0);
    assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
    assert.deepEqual(f.calls, ["authorize"]);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("still synchronizes achievements separately when the souvenir limit is reached", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse(
      "achievements/souvenir-limit-reached",
      400
    );
    await f.run();
    assert.deepEqual(f.calls, ["authorize", "sync"]);
    assert.equal(f.saved().status, "terminal");
    f.worker.groupedSouvenirWorker.stop();
  });

  it("keeps transient, unrecognized and foreign-client errors retryable", async () => {
    for (const error of [
      errorResponse("capacity", 429),
      errorResponse("temporary", 503),
      errorResponse("unknown", 404),
      errorResponse("achievements/souvenir-not-found", 404, "other-client"),
      new Error("network"),
    ]) {
      const f = fixture();
      f.state.authorizationError = error;
      await f.run();
      assert.equal(f.saved().status, "pending");
      assert.equal([...f.timers][0]?.delay, 10_000);
      f.worker.groupedSouvenirWorker.stop();
    }
  });

  it("persists a subscription pause across triggers and restart without an automatic retry timer", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse(
      "subscription/active-subscription-required",
      400
    );
    await f.run();
    assert.equal(f.saved().status, "paused");
    assert.equal(f.timers.size, 0);
    f.state.now += RETENTION_MS * 2;
    await f.run();
    f.worker.groupedSouvenirWorker.stop();
    const restarted = f.restart();
    await restarted.groupedSouvenirWorker.trigger();
    await f.settle();
    assert.deepEqual(f.calls, ["authorize"]);
    assert.deepEqual(f.removed, []);
    assert.equal(f.store.size, 1);
    assert.equal(f.timers.size, 0);
    restarted.groupedSouvenirWorker.stop();
  });

  it("does not resume after an unchanged rejected subscription, an expired one or another owner", async () => {
    const f = fixture();
    const expiry = f.state.now + RETENTION_MS;
    f.state.user.subscription = {
      expiresAt: new Date(expiry).toISOString(),
    } as User["subscription"];
    f.state.authorizationError = errorResponse(
      "subscription/active-subscription-required",
      400
    );
    await f.run();
    await f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
      "owner",
      new Date(expiry)
    );
    await f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
      "owner",
      new Date(f.state.now - 1)
    );
    await f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
      "other-owner",
      new Date(expiry + 1)
    );
    await f.settle();
    assert.equal(f.saved().status, "paused");
    assert.deepEqual(f.calls, ["authorize"]);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("resumes on a fresh renewed subscription and completes the same captured moment", async () => {
    const f = fixture([
      pending({ status: "paused", pausedSubscriptionExpiresAt: null }),
    ]);
    await f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
      "owner",
      new Date(f.state.now + RETENTION_MS)
    );
    await f.settle();
    assert.deepEqual(f.calls, ["authorize", "upload", "sync"]);
    assert.equal(f.store.size, 0);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("resumes a renewal that arrives while a rejected upload request is in flight", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse(
      "subscription/active-subscription-required",
      400
    );
    let resumed: Promise<void> | undefined;
    f.state.onAuthorize = async () => {
      const expiry = new Date(f.state.now + RETENTION_MS);
      f.state.user.subscription = {
        expiresAt: expiry.toISOString(),
      } as User["subscription"];
      f.state.onAuthorize = undefined;
      f.state.authorizationError = undefined;
      resumed = f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
        "owner",
        expiry
      );
    };
    await f.run();
    await resumed;
    await f.settle();
    assert.equal(f.store.size, 0);
    assert.deepEqual(f.calls, ["authorize", "authorize", "upload", "sync"]);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("manual Retry preserves paused records when the fresh profile request fails", async () => {
    const f = fixture([pending({ status: "paused" })]);
    const result = await f.worker.retryAchievementSouvenirSync();
    await f.settle();
    assert.deepEqual(f.calls, ["refresh"]);
    assert.equal(f.saved().status, "paused");
    assert.equal(result.attemptedCount, 0);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("manual Retry requires a fresh eligible subscription and can retry an unchanged expiry", async () => {
    const f = fixture([
      pending({ status: "paused", pausedSubscriptionExpiresAt: 1 }),
    ]);
    f.state.fresh = f.state.user;
    f.state.active = false;
    await f.worker.retryAchievementSouvenirSync();
    assert.equal(f.saved().status, "paused");
    f.state.active = true;
    const result = await f.worker.retryAchievementSouvenirSync();
    await f.settle();
    assert.equal(result.attemptedCount, 1);
    assert.equal(result.syncedCount, 1);
    assert.equal(f.store.size, 0);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("does not gate existing reservations on cached subscription activity", async () => {
    const f = fixture();
    f.state.active = false;
    await f.run();
    assert.equal(f.store.size, 0);
    assert.deepEqual(f.calls, ["authorize", "upload", "sync"]);
    f.worker.groupedSouvenirWorker.stop();
  });
});
