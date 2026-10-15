import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import type {
  PendingAchievementSouvenir,
  SteamAchievement,
  User,
} from "@types";
import * as policy from "./grouped-souvenir-retry-policy.js";
import * as payload from "./grouped-souvenir-payload.js";
import * as syncStatus from "./grouped-souvenir-sync-status.js";
import * as syncItem from "./grouped-souvenir-sync-item.js";
import { composeAssetsWithArtwork } from "../../../shared/artwork-resolver.js";

const RETENTION_MS = 7 * 24 * 60 * 60_000;
const PAUSED_RETENTION_MS = 30 * 24 * 60 * 60_000;
const METADATA_TIMEOUT_MS = 5_000;
const noop = () => undefined;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
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
  const timers = new Set<{
    delay: number;
    unref: () => void;
    fire: () => void;
  }>();
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
    catalogueFetch: undefined as
      | (() => Promise<SteamAchievement[]>)
      | undefined,
    metadataSignal: undefined as AbortSignal | undefined,
    onList: undefined as (() => Promise<void>) | undefined,
    rmError: undefined as unknown,
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
          if (state.rmError) throw state.rmError;
          removed.push(path);
        },
      },
    },
    "@main/constants": {
      SOUVENIR_RETRY_BASE_DELAY_MS: 10_000,
      SOUVENIR_RETRY_MAX_DELAY_MS: 15 * 60_000,
      SOUVENIR_TERMINAL_RETENTION_MS: RETENTION_MS,
      SOUVENIR_PAUSED_RETENTION_MS: PAUSED_RETENTION_MS,
      SOUVENIR_SYNC_METADATA_TIMEOUT_MS: METADATA_TIMEOUT_MS,
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
      levelKeys: {
        user: "user",
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
    },
    "@shared": { composeAssetsWithArtwork },
    "./achievement-sync-coordinator": {
      ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS: 20_000,
      achievementSyncCoordinator: {
        captureCurrent: (_key: string, current: () => boolean) => current,
        runRequest: async (_key: string, task: () => Promise<unknown>) =>
          task(),
        runMerge: async (
          _key: string,
          task: (current: () => boolean) => Promise<unknown>
        ) => task(() => true),
      },
    },
    "./reconcile-achievement-memory": {
      reconcileAchievementMemory: async () => undefined,
    },
    "../hydra-api": {
      HydraApi: {
        isLoggedIn: () => state.loggedIn,
        hasActiveSubscription: () => state.active,
        getAuthContext: () =>
          state.loggedIn ? { userId: state.user.id } : null,
        isAuthContextCurrent: () => state.loggedIn,
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
        list: async () => {
          const records = [...store.values()].map((record) =>
            structuredClone(record)
          );
          await state.onList?.();
          return records;
        },
        replaceClientId: async (
          clientId: string,
          record: PendingAchievementSouvenir
        ) => {
          store.delete(clientId);
          store.set(record.clientId, structuredClone(record));
        },
        acknowledge: async (record: PendingAchievementSouvenir) => {
          store.delete(record.clientId);
        },
      },
      LocalSouvenirAssetStore: {},
    },
    "./grouped-souvenir-retry-policy": policy,
    "./grouped-souvenir-sync-status": syncStatus,
    "./get-game-achievement-data": {
      getGameAchievementData: async (
        _objectId: string,
        _shop: string,
        _cached: boolean,
        _current: unknown,
        options?: { signal?: AbortSignal }
      ) => {
        calls.push("catalogue");
        state.metadataSignal = options?.signal;
        if (state.catalogueFetch) return state.catalogueFetch();
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
      (callback: () => void, delay: number) => {
        const timer = { delay, unref: noop, fire: callback };
        timers.add(timer);
        return timer;
      },
      (timer: { delay: number; unref: () => void; fire: () => void }) => {
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

const networkError = { isAxiosError: true, message: "Network Error" };
const conflictResponse = (reason: string) => ({
  isAxiosError: true,
  response: {
    status: 409,
    data: {
      message: "achievements/souvenir-conflict",
      clientId: "client-1",
      reason,
    },
  },
});

const retryUntilStopped = async (
  f: ReturnType<typeof fixture>,
  limit: number
) => {
  for (let attempt = 1; attempt <= limit; attempt++) {
    await f.run();
    f.state.now += 15 * 60_000;
    if ([...f.store.values()][0]?.status !== "pending") return attempt;
  }
  return limit;
};

describe("grouped souvenir worker recovery", () => {
  it("returns cleanup items with raw names when optional catalogue loading never completes", async () => {
    const f = fixture([pending({ status: "paused" })]);
    f.state.catalogueFetch = () => new Promise(() => {});
    const loading = f.worker.getAchievementSouvenirSyncDetails();
    await f.settle();
    const timeout = [...f.timers].find(
      (timer) => timer.delay === METADATA_TIMEOUT_MS
    );
    assert.ok(timeout, "optional metadata loading must have a deadline");
    timeout.fire();
    const details = await loading;
    assert.equal(details.items[0].screenshotPath, "/fixture/photo.jpeg");
    assert.deepEqual(details.items[0].achievementNames, ["FIRST"]);
    assert.equal(f.state.metadataSignal?.aborted, true);
    assert.equal(f.timers.size, 0);
  });

  it("does not let subscription renewal recreate a souvenir deleted by concurrent cleanup", async () => {
    const f = fixture([pending({ status: "paused" })]);
    const snapshotRead = deferred();
    const releaseSnapshot = deferred();
    f.state.authorizationError = new Error("network unavailable");
    f.state.onList = async () => {
      f.state.onList = undefined;
      snapshotRead.resolve();
      await releaseSnapshot.promise;
    };
    const renewal =
      f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
        "owner",
        new Date(f.state.now + RETENTION_MS)
      );
    await snapshotRead.promise;
    const cleanup = f.worker.cleanupAchievementSouvenirSync();
    await f.settle();
    releaseSnapshot.resolve();
    const [, result] = await Promise.all([renewal, cleanup]);
    await f.settle();
    assert.equal(result.deletedCount, 1);
    assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
    assert.equal(
      f.store.size,
      0,
      "a stale renewal snapshot must not restore a deleted record"
    );
    assert.deepEqual(f.calls, []);
    f.worker.groupedSouvenirWorker.stop();
  });

  for (const scope of ["game", "shop"] as const) {
    for (const recoveryMode of [undefined, "sync_achievements_only"] as const) {
      it(`does not let renewal undo ${scope} cancellation of a paused ${recoveryMode ?? "souvenir"}`, async () => {
        const gameKey = scope === "game" ? "steam:game" : "launchbox:game";
        const f = fixture([
          pending({ gameKey, status: "paused", recoveryMode }),
        ]);
        const snapshotRead = deferred();
        const releaseSnapshot = deferred();
        f.state.onList = async () => {
          f.state.onList = undefined;
          snapshotRead.resolve();
          await releaseSnapshot.promise;
        };
        const renewal =
          f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
            "owner",
            new Date(f.state.now + RETENTION_MS)
          );
        await snapshotRead.promise;
        const cancellation =
          scope === "game"
            ? f.worker.cancelPendingSouvenirsForGame(gameKey)
            : f.worker.cancelPendingSouvenirsForShop("launchbox");
        await f.settle();
        releaseSnapshot.resolve();
        await Promise.all([renewal, cancellation]);
        await f.run();
        assert.deepEqual(
          f.calls,
          [],
          "reset progress must never be uploaded by renewal"
        );
        assert.equal(
          f.store.size,
          0,
          "cancellation must not be undone by a stale renewal snapshot"
        );
        assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
        f.worker.groupedSouvenirWorker.stop();
      });
    }
  }

  for (const scope of ["game", "shop"] as const) {
    const gameKey = scope === "game" ? "steam:game" : "launchbox:game";
    const cancel = (f: ReturnType<typeof fixture>) =>
      scope === "game"
        ? f.worker.cancelPendingSouvenirsForGame(gameKey)
        : f.worker.cancelPendingSouvenirsForShop("launchbox");

    it(`keeps ${scope} cancellation ahead of a later renewal`, async () => {
      const f = fixture([
        pending({
          gameKey,
          status: "paused",
          recoveryMode: "sync_achievements_only",
        }),
      ]);
      const snapshotRead = deferred();
      const releaseSnapshot = deferred();
      f.state.onList = async () => {
        f.state.onList = undefined;
        snapshotRead.resolve();
        await releaseSnapshot.promise;
      };
      const cancellation = cancel(f);
      await snapshotRead.promise;
      const renewal =
        f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
          "owner",
          new Date(f.state.now + RETENTION_MS)
        );
      await f.settle();
      releaseSnapshot.resolve();
      await Promise.all([cancellation, renewal]);
      await f.run();
      assert.deepEqual(f.calls, []);
      assert.equal(f.store.size, 0);
      assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
      f.worker.groupedSouvenirWorker.stop();
    });

    it(`waits for an in-flight upload before finishing ${scope} cancellation`, async () => {
      const f = fixture([pending({ gameKey })]);
      const requestStarted = deferred();
      const releaseRequest = deferred();
      f.state.authorizationError = new Error("network unavailable");
      f.state.onAuthorize = async () => {
        requestStarted.resolve();
        await releaseRequest.promise;
      };
      const upload = f.worker.groupedSouvenirWorker.trigger();
      await requestStarted.promise;
      let cancelled = false;
      const cancellation = cancel(f).then(() => {
        cancelled = true;
      });
      await f.settle();
      assert.equal(cancelled, false);
      releaseRequest.resolve();
      await Promise.all([upload, cancellation]);
      await f.run();
      assert.deepEqual(f.calls, ["authorize"]);
      assert.equal(f.store.size, 0);
      assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
      f.worker.groupedSouvenirWorker.stop();
    });

    it(`preserves records outside the cancelled ${scope}`, async () => {
      const f = fixture([
        pending({ gameKey, status: "paused" }),
        pending({
          clientId: "other-game",
          gameKey: "steam:game-other",
          status: "paused",
          screenshotPath: "/fixture/other-game.jpeg",
        }),
        pending({
          clientId: "other-shop",
          gameKey: "launchbox-other:game",
          status: "paused",
          screenshotPath: "/fixture/other-shop.jpeg",
        }),
      ]);
      await cancel(f);
      assert.deepEqual([...f.store.keys()], ["other-game", "other-shop"]);
      assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
      assert.deepEqual(f.calls, []);
    });
  }

  it("serializes overlapping renewal refreshes without duplicate uploads", async () => {
    const f = fixture([pending({ status: "paused" })]);
    const expiry = new Date(f.state.now + RETENTION_MS);
    await Promise.all([
      f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
        "owner",
        expiry
      ),
      f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
        "owner",
        expiry
      ),
    ]);
    await f.settle();
    assert.deepEqual(f.calls, ["authorize", "upload", "sync"]);
    assert.equal(f.store.size, 0);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("continues cleanup after a queued renewal fails", async () => {
    const f = fixture([pending({ status: "paused" })]);
    f.state.onList = async () => {
      f.state.onList = undefined;
      throw new Error("storage unavailable");
    };
    await assert.rejects(
      f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
        "owner",
        new Date(f.state.now + RETENTION_MS)
      ),
      /storage unavailable/
    );
    const result = await f.worker.cleanupAchievementSouvenirSync();
    assert.equal(result.deletedCount, 1);
    assert.equal(f.store.size, 0);
  });

  it("does not resume queued records if the user signs out while waiting", async () => {
    const f = fixture([pending({ status: "paused" })]);
    const release = deferred();
    const occupied = f.worker.groupedSouvenirWorker.serializeQueueChanges(
      () => release.promise
    );
    const renewal =
      f.worker.groupedSouvenirWorker.resumeAfterSubscriptionRefresh(
        "owner",
        new Date(f.state.now + RETENTION_MS)
      );
    f.state.loggedIn = false;
    release.resolve();
    await Promise.all([occupied, renewal]);
    assert.equal(f.saved().status, "paused");
    assert.deepEqual(f.calls, []);
  });
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

  it("stops at 20 rejections even when transient failures interleave", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse("unknown", 404);
    assert.equal(await retryUntilStopped(f, 19), 19);
    for (const error of [
      networkError,
      errorResponse("capacity", 429),
      errorResponse("temporary", 503),
    ]) {
      f.state.authorizationError = error;
      await retryUntilStopped(f, 1);
    }
    assert.equal(f.saved().status, "pending");
    f.state.authorizationError = errorResponse("unknown", 404);
    assert.equal(await retryUntilStopped(f, 1), 1);
    assert.equal(f.saved().status, "terminal");
    assert.equal(f.saved().rejectedAttemptCount, 20);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("stops at 20 rejections when the error message changes each time", async () => {
    const f = fixture();
    let rejection = 0;
    f.state.authorizationError = errorResponse("invalid", 400);
    f.state.onAuthorize = async () => {
      rejection += 1;
      f.state.authorizationError = errorResponse(`invalid ${rejection}`, 400);
    };
    assert.equal(await retryUntilStopped(f, 40), 20);
    assert.equal(f.saved().status, "terminal");
    f.worker.groupedSouvenirWorker.stop();
  });

  it("stops reauthorize, rotate, rebuild and recovery loops at the rejection cap", async () => {
    const cases = [
      {
        records: [pending()],
        error: conflictResponse("reservation_not_found"),
      },
      { records: [pending()], error: conflictResponse("image_key_in_use") },
      {
        records: [pending()],
        error: conflictResponse("achievement_not_found"),
      },
      {
        records: [pending({ recoveryMode: "sync_achievements_only" })],
        error: errorResponse("unknown", 422),
      },
      {
        records: [pending({ recoveryMode: "sync_achievements_only" })],
        error: conflictResponse("achievement_already_assigned"),
      },
    ];
    for (const { records, error } of cases) {
      const f = fixture(records);
      f.state.syncError = error;
      f.state.catalogueFetch = () => Promise.reject(new Error("unavailable"));
      assert.equal(await retryUntilStopped(f, 40), 20);
      const [record] = [...f.store.values()];
      assert.equal(record.status, "terminal");
      assert.equal(record.attemptCount, 20);
      f.worker.groupedSouvenirWorker.stop();
    }
  });

  it("starts achievement-only recovery when the 20th rejection abandons the souvenir", async () => {
    const f = fixture([pending({ rejectedAttemptCount: 19 })]);
    f.state.authorizationError = conflictResponse(
      "achievement_already_assigned"
    );
    await f.run();
    assert.deepEqual(f.calls, ["authorize", "sync"]);
    assert.equal(f.saved().status, "terminal");
    assert.equal(f.saved().recoveryMode, undefined);
    f.worker.groupedSouvenirWorker.stop();

    const offline = fixture([pending({ rejectedAttemptCount: 19 })]);
    offline.state.authorizationError = conflictResponse(
      "achievement_already_assigned"
    );
    offline.state.syncError = networkError;
    await offline.run();
    assert.equal(offline.saved().status, "pending");
    assert.equal(offline.saved().recoveryMode, "sync_achievements_only");
    offline.worker.groupedSouvenirWorker.stop();
  });

  it("does not pause again when the attempt after Retry is a network failure", async () => {
    const f = fixture([
      pending({ status: "paused", answeredFailureCount: 200 }),
    ]);
    f.state.fresh = f.state.user;
    f.state.authorizationError = networkError;
    await f.worker.retryAchievementSouvenirSync();
    await f.settle();
    assert.equal(f.saved().status, "pending");
    f.state.now += 15 * 60_000;
    f.state.authorizationError = errorResponse("temporary", 503);
    await retryUntilStopped(f, 1);
    assert.equal(f.saved().status, "paused");
    f.worker.groupedSouvenirWorker.stop();
  });

  it("pauses after 200 answered failures, never for network errors, and Retry resumes it", async () => {
    const offline = fixture();
    offline.state.authorizationError = networkError;
    assert.equal(await retryUntilStopped(offline, 200), 200);
    offline.state.authorizationError = errorResponse("temporary", 503);
    await retryUntilStopped(offline, 1);
    assert.equal(offline.saved().status, "pending");
    assert.equal(offline.saved().attemptCount, 201);
    assert.equal(offline.saved().answeredFailureCount, 1);
    offline.worker.groupedSouvenirWorker.stop();

    const f = fixture();
    f.state.authorizationError = errorResponse("temporary", 503);
    assert.equal(await retryUntilStopped(f, 250), 200);
    assert.equal(f.saved().status, "paused");
    f.state.fresh = f.state.user;
    f.state.authorizationError = undefined;
    const result = await f.worker.retryAchievementSouvenirSync();
    await f.settle();
    assert.equal(result.syncedCount, 1);
    assert.equal(f.store.size, 0);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("removes a paused souvenir and its screenshot after 30 days", async () => {
    const f = fixture();
    f.state.authorizationError = errorResponse(
      "subscription/active-subscription-required",
      400
    );
    await f.run();
    const pausedAt = f.saved().lastAttemptAt!;
    f.state.now = pausedAt + PAUSED_RETENTION_MS - 1;
    await f.run();
    assert.equal(f.saved().status, "paused");
    assert.deepEqual(f.removed, []);
    f.state.now += 1;
    await f.run();
    assert.equal(f.store.size, 0);
    assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
    assert.equal(f.timers.size, 0);
    assert.deepEqual(f.calls, ["authorize"]);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("does not write back an expired paused souvenir whose game was deleted", async () => {
    const f = fixture([pending({ status: "paused", lastAttemptAt: 1 })]);
    f.state.deleted = true;
    await f.run();
    assert.equal(f.store.size, 0);
    assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
    f.worker.groupedSouvenirWorker.stop();
  });

  it("keeps an expired record until its screenshot can be removed", async () => {
    const f = fixture([pending({ status: "terminal", lastAttemptAt: 1 })]);
    f.state.rmError = Object.assign(new Error("busy"), { code: "EBUSY" });
    await f.run();
    assert.equal(f.saved().status, "terminal");
    assert.equal(f.timers.size, 0);
    f.state.rmError = undefined;
    await f.run();
    assert.equal(f.store.size, 0);
    assert.deepEqual(f.removed, ["/fixture/photo.jpeg"]);
    f.worker.groupedSouvenirWorker.stop();
  });
});
