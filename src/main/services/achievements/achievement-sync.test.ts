import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { build } from "esbuild";
import type { Game } from "@types";
import type { PendingAchievementSync } from "./achievement-sync-worker";
import type { HydraApiAuthContext } from "../hydra-auth-context";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
async function fixture(
  t: TestContext,
  options: { metadata?: boolean; reset?: boolean; view?: boolean } = {}
) {
  const key = `__achievementSync${randomUUID().replaceAll("-", "")}`;
  const records = new Map<string, PendingAchievementSync>();
  const requests: Array<{
    body: {
      id: string;
      achievements: Array<{
        name: string;
        unlockTime: number;
        hardcore?: boolean;
      }>;
    };
    options: { authContext: HydraApiAuthContext; timeout: number };
    gate: ReturnType<typeof deferred<unknown>>;
  }> = [];
  const context = {
    environment: "local",
    userId: "fixture-user",
    generation: 1,
  };
  const state = {
    context: context as typeof context | null,
    preferenceGate: null as Promise<unknown> | null,
    records,
    pendingSouvenirs: new Map<string, Record<string, string>>(),
    recordsReadGate: null as Promise<void> | null,
    recordsReadStarted: null as (() => void) | null,
    recordReadGate: null as Promise<void> | null,
    recordReadStarted: null as (() => void) | null,
    requests,
    updates: [] as Array<{ channel: string; achievements: unknown }>,
    driveWrites: [] as Array<{
      shop: string;
      objectId: string;
      achievements: Array<{ name: string }>;
    }>,
    driveFailure: null as unknown,
    catalogueGate: null as Promise<unknown> | null,
    resetGate: null as Promise<void> | null,
    remoteGate: null as Promise<unknown> | null,
    deletes: [] as Array<{ url: string; options: unknown }>,
    deleteFailures: [] as unknown[],
    events: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
    game: null as Game | null,
  };
  (globalThis as unknown as Record<string, unknown>)[key] = state;
  t.after(() => {
    delete (globalThis as unknown as Record<string, unknown>)[key];
  });
  const root = path.resolve("node_modules/.cache/lbx-1154-tests");
  await fs.mkdir(root, { recursive: true });
  const outfile = path.join(root, `${key}.mjs`);
  const actual = new Set([
    "merge-achievements",
    "achievement-memory-store",
    "reconcile-achievement-memory",
    "achievement-sync-coordinator",
    "achievement-sync-worker",
    "merge-unlocked-achievements",
    "pending-achievement-souvenir-store",
    "game-request-queue",
  ]);
  if (options.metadata || options.view) actual.add("get-game-achievement-data");
  if (options.reset) actual.add("reset-game-achievements");
  if (options.view) actual.add("get-unlocked-achievements");
  const stub = `const state = globalThis[${JSON.stringify(key)}];
    export const isAxiosError = value => Boolean(value?.isAxiosError);
    export const isAchievementSouvenirsEnabled = () => false;
    export class UserNotLoggedInError extends Error {};
    export const HydraApi = { get: async () => null, getResponse: async () => state.catalogueGate ? await state.catalogueGate : {status:200,data:[],headers:{}}, delete: async (url, options) => {state.deletes.push({url, options}); const failure = state.deleteFailures.shift(); if (failure) throw failure;}, getAuthContext: () => state.context, isAuthContextCurrent: context => Boolean(state.context && state.context.userId === context.userId && state.context.generation === context.generation), put: async (_url, body, options) => { let resolve, reject; const promise = new Promise((done, fail) => {resolve = done; reject = fail;}); state.requests.push({body, options, gate: {promise, resolve, reject}}); return promise; } };
    export const db = { get: async key => { if (state.preferenceGate) await state.preferenceGate; return key === "language" ? "en" : { achievementNotificationsEnabled: false }; }, sublevel: () => ({ get: async key => { const item = state.records.get(key); state.recordReadStarted?.(); if (state.recordReadGate) await state.recordReadGate; if (!item) throw new Error('missing'); return item; }, put: async (key, item) => state.records.set(key, item), del: async key => state.records.delete(key), values: () => ({all: async () => {const rows = [...state.records.values()]; state.recordsReadStarted?.(); if (state.recordsReadGate) await state.recordsReadGate; return rows;}}) }) };
    export const pendingAchievementSouvenirsSublevel = {get: async key => state.pendingSouvenirs.get(key), put: async (key, value) => state.pendingSouvenirs.set(key, value), del: async key => state.pendingSouvenirs.delete(key)};
    export const levelKeys = {game: (shop, id) => shop + ':' + id, userPreferences: 'preferences', language: 'language'};
    export const WindowManager = { mainWindow: { webContents: { send: (channel, achievements) => state.updates.push({channel, achievements}) } } };
    export const getUnlockedAchievements = async () => [];
    export const presentCombinedAchievements = () => [];
    export const publishNewAchievementNotification = () => {};
    export const publishAchievementUnlockNotifications = () => {};
    export const UnlockedAchievementsCache = {invalidate: () => Date.now(), set: () => {}, clear: () => {}, recordCombinedMembers: () => {}};
    export const getRetryAfterMs = error => { const retryAfter = error?.response?.headers?.["retry-after"]; const seconds = typeof retryAfter === "string" || typeof retryAfter === "number" ? Number(retryAfter) : Number.NaN; const date = typeof retryAfter === "string" ? Date.parse(retryAfter) : Number.NaN; if (Number.isFinite(seconds)) return seconds * 1000; if (Number.isFinite(date)) return date - Date.now(); return 0; };
    export const registerEvent = (name, handler) => state.events.set(name, handler);
    export const gamesSublevel = {get: async () => state.game};
    export const collectGameAchievementFiles = async () => [];
    export const updateGameRecord = async () => {};
    export const cancelPendingSouvenirsForGame = async () => {if (state.resetGate) await state.resetGate;};
    export const deleteLocalSouvenirAssetsForGame = async () => {};
    export const AchievementSouvenirStore = {invalidate: () => {}, set: () => {}};
    export const removeShadps4TrophyFile = async () => {};
    export const CombinedAchievementsRequests = {fetch: async () => null};
    export const createCombinedDefinitionLookup = () => () => [];
    export const fetchRemoteUserGameAchievements = async () => state.remoteGate ? await state.remoteGate : {souvenirs:new Map(),unlocked:[],achievements:[]};
    export const logger = {error: () => {}};
    export const achievementsLogger = {error: () => {}, warn: () => {}, log: () => {}};
    export const getGameAchievementData = async () => [];
    export const AchievementWatcherManager = {hasFinishedPreSearch: true, alreadySyncedGames: new Map(), forgetAchievementFiles: () => {}};
    export const achievementNotificationPresenter = {enqueueAchievements: () => {}};
    export const ScreenshotService = {};
    export const PendingAchievementSouvenirStore = {get: async () => ({}), clearSynced: async () => {}};
    export const PendingGroupedSouvenirStore = {};
    export const groupedSouvenirWorker = {trigger: async () => {}};
    export const launchedGamePids = new Map();
    export const Wine = {};
    export const GoogleDriveService = { isSyncEnabled: async () => true };
    export const syncGoogleDriveUnlockedAchievements = async (shop, objectId, achievements) => { if (state.driveFailure) throw state.driveFailure; state.driveWrites.push({ shop, objectId, achievements }); return achievements; };
  `;
  await build({
    stdin: {
      contents: `${options.reset ? "import './src/main/events/library/reset-game-achievements.ts';" : ""} ${options.metadata ? "export {getGameAchievementData} from './src/main/services/achievements/get-game-achievement-data.ts';" : ""} ${options.view ? "export {getUnlockedAchievements} from './src/main/events/user/get-unlocked-achievements.ts';" : ""} export { mergeAchievements } from './src/main/services/achievements/merge-achievements.ts'; export { AchievementMemoryStore } from './src/main/services/achievements/achievement-memory-store.ts'; export { achievementSyncWorker, AchievementSyncWorker, getAchievementSyncRetryDelay, toAchievementSyncPayload } from './src/main/services/achievements/achievement-sync-worker.ts'; export { achievementSyncCoordinator } from './src/main/services/achievements/achievement-sync-coordinator.ts';`,
      resolveDir: process.cwd(),
      sourcefile: "fixture.ts",
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    plugins: [
      {
        name: "isolated-achievement-native-dependencies",
        setup(plugin) {
          plugin.onResolve({ filter: /.*/ }, (args) => {
            if (args.path.startsWith("node:") || args.path === "fs")
              return { path: args.path, external: true };
            const name = path.basename(args.path).replace(/\.(?:js|ts)$/, "");
            if (actual.has(name))
              return {
                path:
                  path
                    .resolve(
                      args.path.startsWith("@main/")
                        ? process.cwd()
                        : args.resolveDir,
                      args.path.replace(/^@main\//, "src/main/")
                    )
                    .replace(/\.js$/, ".ts") +
                  (/\.(?:js|ts)$/.test(args.path) ? "" : ".ts"),
              };
            return { path: args.path, namespace: "fixture" };
          });
          plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: stub,
            loader: "js",
          }));
        },
      },
    ],
  });
  const module = await import(pathToFileURL(outfile).href);
  t.after(() => module.achievementSyncWorker.stop());
  const game = {
    shop: "steam",
    objectId: "620",
    remoteId: "fixture-game",
  } as Game;
  state.game = game;
  module.AchievementMemoryStore.set("steam", "620", {
    achievements: [],
    unlockedAchievements: [],
  });
  const untilRequest = async (count: number) => {
    for (let attempt = 0; attempt < 100 && requests.length < count; attempt++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      requests.length >= count,
      `Expected ${count} requests, got ${requests.length}`
    );
  };
  return {
    ...module,
    state,
    game,
    records,
    requests,
    untilRequest,
    outfile,
    key,
    root,
  };
}

// FORK: unlocks replicate through the user's own Google Drive, so the merge
// path must write there and never enqueue Hydra Cloud achievement PUTs.
test("merges every unlock into memory and replicates the merged list to Google Drive", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "A0", unlockTime: 1 }], false);
  await Promise.all(
    Array.from({ length: 15 }, (_, index) =>
      f.mergeAchievements(
        f.game,
        [{ name: `A${index + 1}`, unlockTime: index + 2 }],
        false
      )
    )
  );
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.length,
    16
  );
  assert.equal(f.requests.length, 0);
  assert.equal(f.state.driveWrites.length, 16);
  const lastWrite = f.state.driveWrites.at(-1)!;
  assert.equal(lastWrite.shop, "steam");
  assert.equal(lastWrite.objectId, "620");
  assert.equal(lastWrite.achievements.length, 16);
});

test("a failed Drive replication keeps the local unlocks", async (t) => {
  const f = await fixture(t);
  f.state.driveFailure = new Error("drive offline");
  await f.mergeAchievements(f.game, [{ name: "A", unlockTime: 1 }], false);
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.length,
    1
  );
  assert.equal(f.state.driveWrites.length, 0);
  assert.equal(f.requests.length, 0);
});

test("an account change during a merge cannot write to the new account's memory", async (t) => {
  const f = await fixture(t);
  const gate = deferred<void>();
  f.state.preferenceGate = gate.promise;
  const merge = f.mergeAchievements(
    f.game,
    [{ name: "A", unlockTime: 1 }],
    false
  );
  const rejected = assert.rejects(merge);
  await new Promise((resolve) => setImmediate(resolve));
  f.state.context = {
    ...f.state.context!,
    userId: "other-user",
    generation: 2,
  };
  gate.resolve();
  await rejected;
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.length,
    0
  );
  assert.equal(f.records.size, 0);
  assert.equal(f.requests.length, 0);
});
test("reset invalidates a durable queue read that completes afterward", async (t) => {
  const f = await fixture(t);
  await f.achievementSyncWorker.enqueue({
    context: f.state.context!,
    gameKey: "steam:620",
    remoteId: f.game.remoteId!,
    shop: "steam",
    objectId: "620",
    achievements: [{ name: "BEFORE_RESET", unlockTime: 1 }],
  });
  const gate = deferred<void>();
  const started = deferred<void>();
  f.state.recordsReadGate = gate.promise;
  f.state.recordsReadStarted = () => started.resolve();
  const run = f.achievementSyncWorker.trigger();
  await started.promise;
  await f.achievementSyncCoordinator.resetGame("steam:620", () =>
    f.achievementSyncWorker.cancelGame("steam:620")
  );
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  for (const request of f.requests) request.gate.resolve(undefined);
  await run;
  assert.equal(f.requests.length, 0);
  assert.equal(f.records.size, 0);
});

test("a queued PUT revalidates durable work before dispatch", async (t) => {
  const f = await fixture(t);
  const gate = deferred<void>();
  const otherRequest = f.achievementSyncCoordinator.runRequest(
    "steam:other",
    () => gate.promise,
    () => true
  );
  await f.achievementSyncWorker.enqueue({
    context: f.state.context!,
    gameKey: "steam:620",
    remoteId: f.game.remoteId!,
    shop: "steam",
    objectId: "620",
    achievements: [{ name: "CANCELED", unlockTime: 1 }],
  });
  const run = f.achievementSyncWorker.trigger();
  await new Promise((resolve) => setImmediate(resolve));
  await f.achievementSyncWorker.cancelGame("steam:620");
  gate.resolve();
  await otherRequest;
  await new Promise((resolve) => setImmediate(resolve));
  for (const request of f.requests) request.gate.resolve(undefined);
  await run;
  assert.equal(f.requests.length, 0);
  assert.equal(f.records.size, 0);
});

test("reset invalidates a pending record read before the PUT is sent", async (t) => {
  const f = await fixture(t);
  await f.achievementSyncWorker.enqueue({
    context: f.state.context!,
    gameKey: "steam:620",
    remoteId: f.game.remoteId!,
    shop: "steam",
    objectId: "620",
    achievements: [{ name: "BEFORE_RESET", unlockTime: 1 }],
  });
  const gate = deferred<void>();
  const started = deferred<void>();
  f.state.recordReadGate = gate.promise;
  f.state.recordReadStarted = () => started.resolve();
  const run = f.achievementSyncWorker.trigger();
  await started.promise;
  const reset = f.achievementSyncCoordinator.resetGame("steam:620", () =>
    f.achievementSyncWorker.cancelGame("steam:620")
  );
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  for (const request of f.requests) request.gate.resolve(undefined);
  await Promise.all([run, reset]);
  assert.equal(f.requests.length, 0);
  assert.equal(f.records.size, 0);
});

test("ordinary PUT payloads follow the API achievement schema", async (t) => {
  const f = await fixture(t);
  const payload = f.toAchievementSyncPayload({
    remoteId: "game",
    achievements: [
      { name: "A", unlockTime: 1, hardcoreUnlockTime: 2, imageKey: "legacy" },
    ],
  });
  assert.deepEqual(payload, {
    id: "game",
    achievements: [{ name: "A", unlockTime: 2, hardcore: true }],
  });
  assert.ok(
    f.getAchievementSyncRetryDelay(
      { isAxiosError: true, response: { headers: { "retry-after": "30" } } },
      0
    ) >= 30000
  );
  assert.equal(
    f.getAchievementSyncRetryDelay(
      {
        isAxiosError: true,
        response: { headers: { "retry-after": String(30 * 24 * 60 * 60) } },
      },
      0
    ),
    60000
  );
});

test(
  "native Electron IPC bursts use the same merge and persistent retry code",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = await fixture(t);
    const script = path.join(f.root, `${f.key}-native.cjs`);
    const profile = path.join(f.root, `${f.key}-profile`);
    await fs.mkdir(profile, { recursive: true });
    await fs.writeFile(
      script,
      `
    const {app, BrowserWindow, ipcMain} = require('electron');
    const {ClassicLevel} = require('classic-level');
    const assert = require('node:assert/strict');
    app.setPath('userData', ${JSON.stringify(profile)});
    app.whenReady().then(async () => {
      const storage = new ClassicLevel(${JSON.stringify(path.join(profile, "pending-sync"))}, {valueEncoding: 'json'});
      await storage.open();
      class Records extends Map {
        async set(key, value) { super.set(key, value); await storage.put(key, value); return this; }
        async delete(key) { const deleted = super.delete(key); await storage.del(key); return deleted; }
      }
      const state = {context: {environment:'local', userId:'fixture-user', generation:1}, preferenceGate:null, records:new Records(), pendingSouvenirs:new Map(), requests:[], updates:[]};
      globalThis[${JSON.stringify(f.key)}] = state;
      const source = await import(${JSON.stringify(pathToFileURL(f.outfile).href)});
      source.AchievementMemoryStore.set('steam','620',{achievements:[],unlockedAchievements:[]});
      const game = {shop:'steam',objectId:'620',remoteId:'fixture-game'};
      ipcMain.handle('fixture:unlock', (_event, index) => source.mergeAchievements(game,[{name:'ACH_'+index,unlockTime:index+1}],false));
      const window = new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
      await window.loadURL('data:text/html,<title>Achievement sync test</title>');
      await window.webContents.executeJavaScript("Promise.all(Array.from({length:16},(_,index)=>require('electron').ipcRenderer.invoke('fixture:unlock',index)))");
      while (!state.requests.length) await new Promise(resolve=>setImmediate(resolve));
      const acknowledgements = setInterval(() => { for (const request of state.requests) { if (!request.completed) { request.completed = true; request.gate.resolve(undefined); } } }, 5);
      await source.achievementSyncWorker.trigger();
      for (const item of state.records.values()) item.nextAttemptAt = 0;
      await source.achievementSyncWorker.trigger();
      clearInterval(acknowledgements);
      assert.ok(state.requests.length <= 2);
      assert.equal(source.AchievementMemoryStore.get('steam','620').unlockedAchievements.length,16);
      assert.equal(state.records.size,0);
      assert.equal((await storage.values().all()).length,0);
      source.achievementSyncWorker.stop();
      await storage.close();
      console.log(JSON.stringify({nativeIPC:'passed',achievements:16,puts:state.requests.length,levelDB:'acknowledged',electron:process.versions.electron}));
      window.destroy(); app.quit();
    }).catch(error=>{console.error(error);app.exit(1);});
  `
    );
    const executable = path.resolve(
      "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
    );
    const { stdout } = await promisify(execFile)(executable, [script], {
      cwd: process.cwd(),
      timeout: 30000,
    });
    assert.match(stdout, /"nativeIPC":"passed"/);
  }
);

test("reset DELETE shares the HTTP queue and carries its captured account", async (t) => {
  const f = await fixture(t, { reset: true });
  const resetGate = deferred<void>();
  f.state.resetGate = resetGate.promise;
  const reset = f.state.events.get("resetGameAchievements")!(
    null,
    "steam",
    "620"
  );
  await new Promise((resolve) => setImmediate(resolve));
  const putGate = deferred<void>();
  const otherGamePut = f.achievementSyncCoordinator.runRequest(
    "steam:other",
    () => putGate.promise,
    () => true
  );
  await new Promise((resolve) => setImmediate(resolve));
  resetGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.deletes.length, 0);
  putGate.resolve();
  await Promise.all([reset, otherGamePut]);
  assert.deepEqual(f.state.deletes, [
    {
      url: "/profile/games/achievements/fixture-game",
      options: { authContext: f.state.context, timeout: 20_000 },
    },
  ]);
});

test("a busy reset DELETE is retried and completes the reset", async (t) => {
  const f = await fixture(t, { reset: true });
  f.AchievementMemoryStore.set("steam", "620", {
    achievements: [],
    unlockedAchievements: [{ name: "A", unlockTime: 1 }],
  });
  f.state.deleteFailures.push({
    isAxiosError: true,
    response: { status: 429, headers: { "retry-after": "0" } },
  });
  await f.state.events.get("resetGameAchievements")!(null, "steam", "620");
  assert.equal(f.state.deletes.length, 2);
  assert.deepEqual(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements,
    []
  );
});

test("account changes during reset cancel its DELETE and leave the new account's memory", async (t) => {
  const f = await fixture(t, { reset: true });
  const gate = deferred<void>();
  f.state.resetGate = gate.promise;
  const reset = f.state.events.get("resetGameAchievements")!(
    null,
    "steam",
    "620"
  );
  const rejected = assert.rejects(reset);
  await new Promise((resolve) => setImmediate(resolve));
  f.state.context = {
    ...f.state.context!,
    userId: "other-user",
    generation: 2,
  };
  f.AchievementMemoryStore.set("steam", "620", {
    achievements: [],
    unlockedAchievements: [{ name: "NEW-ACCOUNT", unlockTime: 3 }],
  });
  gate.resolve();
  await rejected;
  assert.equal(f.state.deletes.length, 0);
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements[0].name,
    "NEW-ACCOUNT"
  );
});

test("catalogue responses preserve unlocks added while metadata was loading", async (t) => {
  const f = await fixture(t, { metadata: true });
  const gate = deferred<unknown>();
  f.state.catalogueGate = gate.promise;
  const metadata = f.getGameAchievementData("620", "steam", false);
  await new Promise((resolve) => setImmediate(resolve));
  f.AchievementMemoryStore.set("steam", "620", {
    achievements: [],
    unlockedAchievements: [{ name: "NEW", unlockTime: 3 }],
  });
  gate.resolve({ status: 200, data: [], headers: {} });
  await metadata;
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements[0].name,
    "NEW"
  );
});

test("stale achievement view responses cannot update the next account's memory", async (t) => {
  const f = await fixture(t, { view: true });
  const gate = deferred<unknown>();
  f.state.remoteGate = gate.promise;
  const view = f.getUnlockedAchievements("620", "steam", true);
  await new Promise((resolve) => setImmediate(resolve));
  f.state.context = {
    ...f.state.context!,
    userId: "other-user",
    generation: 2,
  };
  f.AchievementMemoryStore.set("steam", "620", {
    achievements: [],
    unlockedAchievements: [{ name: "NEW-ACCOUNT", unlockTime: 3 }],
  });
  gate.resolve({
    souvenirs: new Map(),
    unlocked: [{ name: "OLD-ACCOUNT", unlockTime: 2 }],
    achievements: [],
  });
  await assert.rejects(view, { name: "AchievementSyncCancelledError" });
  assert.deepEqual(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.map(
      (item: { name: string }) => item.name
    ),
    ["NEW-ACCOUNT"]
  );
});

test("reset invalidates an achievement view that was already fetching", async (t) => {
  const f = await fixture(t, { view: true });
  const gate = deferred<unknown>();
  f.state.remoteGate = gate.promise;
  const view = f.getUnlockedAchievements("620", "steam", true);
  await new Promise((resolve) => setImmediate(resolve));
  await f.achievementSyncCoordinator.resetGame("steam:620", async () => {
    f.AchievementMemoryStore.set("steam", "620", {
      achievements: [],
      unlockedAchievements: [],
    });
  });
  gate.resolve({
    souvenirs: new Map(),
    unlocked: [{ name: "BEFORE-RESET", unlockTime: 2 }],
    achievements: [],
  });
  await assert.rejects(view, { name: "AchievementSyncCancelledError" });
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.length,
    0
  );
});
