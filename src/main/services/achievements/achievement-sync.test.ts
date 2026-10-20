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
    export const registerEvent = (name, handler) => state.events.set(name, handler);
    export const gamesSublevel = {get: async () => state.game};
    export const collectGameAchievementFiles = async () => [];
    export const updateGameRecord = async () => {};
    export const cancelPendingSouvenirsForGame = async () => {if (state.resetGate) await state.resetGate;};
    export const deleteLocalSouvenirAssetsForGame = async () => {};
    export const AchievementSouvenirStore = {invalidate: () => {}, set: () => {}};
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

test("sixteen local merges preserve every unlock and coalesce into at most two PUTs", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "A0", unlockTime: 1 }], false);
  await f.untilRequest(1);
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
  assert.equal(f.requests.length, 1);
  f.requests[0]!.gate.resolve(undefined);
  for (let round = 0; round < 20; round++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  const coalesced = [...f.records.values()][0]!;
  assert.ok(coalesced.nextAttemptAt > Date.now());
  coalesced.nextAttemptAt = 0;
  void f.achievementSyncWorker.trigger();
  await f.untilRequest(2);
  assert.equal(f.requests[1]!.body.achievements.length, 16);
  f.requests[1]!.gate.resolve(undefined);
  await f.achievementSyncWorker.trigger();
  assert.equal(f.records.size, 0);
});
test("a busy response retains work, respects Retry-After and retries after a worker restart", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "A", unlockTime: 1 }], false);
  await f.untilRequest(1);
  f.requests[0]!.gate.reject({
    isAxiosError: true,
    response: { status: 503, headers: { "retry-after": "2" } },
  });
  await f.achievementSyncWorker.trigger();
  f.achievementSyncWorker.stop();
  const entry = [...f.records.values()][0];
  assert.ok(entry.nextAttemptAt >= Date.now() + 1500);
  assert.equal(entry.attempts, 1);
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.length,
    1
  );
  entry.nextAttemptAt = 0;
  const restarted = new f.AchievementSyncWorker();
  t.after(() => restarted.stop());
  const run = restarted.trigger();
  await f.untilRequest(2);
  f.requests[1]!.gate.resolve(undefined);
  await run;
  assert.equal(f.records.size, 0);
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
test("reset removes durable work after an in-flight PUT and prevents resurrection", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "A", unlockTime: 1 }], false);
  await f.untilRequest(1);
  const reset = f.achievementSyncCoordinator.resetGame(
    "steam:620",
    async () => {
      await f.achievementSyncWorker.cancelGame("steam:620");
      f.AchievementMemoryStore.set("steam", "620", {
        achievements: [],
        unlockedAchievements: [],
      });
    }
  );
  f.requests[0]!.gate.resolve(undefined);
  await reset;
  await f.achievementSyncWorker.trigger();
  assert.equal(f.records.size, 0);
  assert.equal(
    f.AchievementMemoryStore.get("steam", "620").unlockedAchievements.length,
    0
  );
  assert.equal(f.requests.length, 1);
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

test("ordinary sync retains legacy souvenir keys that were not acknowledged", async (t) => {
  const f = await fixture(t);
  f.state.pendingSouvenirs.set("steam:620", { A: "legacy-image" });
  await f.mergeAchievements(f.game, [{ name: "A", unlockTime: 1 }], false);
  await f.untilRequest(1);
  assert.deepEqual(f.requests[0]!.body.achievements, [
    { name: "A", unlockTime: 1 },
  ]);
  f.requests[0]!.gate.resolve(undefined);
  await f.achievementSyncWorker.trigger();
  assert.deepEqual(f.state.pendingSouvenirs.get("steam:620"), {
    A: "legacy-image",
  });
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

test("remote reconciliation refreshes the renderer and preserves newer local unlocks", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "LOCAL", unlockTime: 1 }], false);
  await f.untilRequest(1);
  f.requests[0]!.gate.resolve({
    shop: "steam",
    objectId: "620",
    achievements: [{ name: "REMOTE", unlockTime: 2 }],
  });
  await f.achievementSyncWorker.trigger();
  assert.deepEqual(
    f.AchievementMemoryStore.get("steam", "620")
      .unlockedAchievements.map((item: { name: string }) => item.name)
      .sort(),
    ["LOCAL", "REMOTE"]
  );
  assert.equal(f.state.updates.length, 1);
  assert.equal(f.state.updates[0]?.channel, "on-update-achievements-620-steam");
});

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

test("new unlocks preserve a rate-limit retry deadline", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "A", unlockTime: 1 }], false);
  await f.untilRequest(1);
  f.requests[0]!.gate.reject({
    isAxiosError: true,
    response: { status: 429, headers: { "retry-after": "2" } },
  });
  await f.achievementSyncWorker.trigger();
  f.achievementSyncWorker.stop();
  const original = [...f.records.values()][0]!;
  await f.mergeAchievements(f.game, [{ name: "B", unlockTime: 2 }], false);
  const latest = [...f.records.values()][0]!;
  assert.ok(latest.nextAttemptAt >= original.nextAttemptAt);
  assert.equal(latest.attempts, original.attempts);
  await f.achievementSyncWorker.trigger();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(
    latest.achievements.map((item: { name: string }) => item.name),
    ["A", "B"]
  );
});

test("a failed in-flight request defers the newer coalesced snapshot", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, [{ name: "A", unlockTime: 1 }], false);
  await f.untilRequest(1);
  await f.mergeAchievements(f.game, [{ name: "B", unlockTime: 2 }], false);
  f.requests[0]!.gate.reject({
    isAxiosError: true,
    response: { status: 503, headers: { "retry-after": "2" } },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const latest = [...f.records.values()][0]!;
  assert.ok(latest.nextAttemptAt >= Date.now() + 1500);
  assert.equal(latest.attempts, 1);
  assert.deepEqual(
    latest.achievements.map((item: { name: string }) => item.name),
    ["A", "B"]
  );
  await f.achievementSyncWorker.trigger();
  assert.equal(f.requests.length, 1);
});

const acknowledgeAll = async (f: Awaited<ReturnType<typeof fixture>>) => {
  for (let round = 0; round < 20; round++) {
    for (const request of f.requests) request.gate.resolve(undefined);
    void f.achievementSyncWorker.trigger();
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const rewrittenUnlocks = [
  { name: "A", unlockTime: 1 },
  { name: "B", unlockTime: 2 },
];

test("watcher rewrites of an unchanged achievement file send one PUT", async (t) => {
  const f = await fixture(t);
  for (let tick = 0; tick < 16; tick++) {
    await f.mergeAchievements(f.game, rewrittenUnlocks, true);
    await acknowledgeAll(f);
  }
  assert.equal(f.requests.length, 1);
  assert.equal(f.records.size, 0);
});

test("an unchanged merge during an in-flight PUT does not resend", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  await f.untilRequest(1);
  await f.mergeAchievements(f.game, [], false);
  await acknowledgeAll(f);
  assert.equal(f.requests.length, 1);
  assert.equal(f.records.size, 0);
});

test("unlocks inside the coalesce window are sent together once it elapses", async (t) => {
  const f = await fixture(t);
  for (let tick = 0; tick < 4; tick++) {
    await f.mergeAchievements(
      f.game,
      [{ name: `N${tick}`, unlockTime: tick + 1 }],
      true
    );
    await acknowledgeAll(f);
  }
  assert.equal(f.requests.length, 1);
  const coalesced = [...f.records.values()][0]!;
  assert.ok(coalesced.nextAttemptAt > Date.now());
  coalesced.nextAttemptAt = 0;
  await acknowledgeAll(f);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(
    f.requests[1]!.body.achievements.map((item) => item.name),
    ["N0", "N1", "N2", "N3"]
  );
  assert.equal(f.records.size, 0);
});

test("a reordered server response does not cause a resend of the same unlocks", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  await f.untilRequest(1);
  f.requests[0]!.gate.resolve({
    shop: "steam",
    objectId: "620",
    achievements: [
      { name: "b", unlockTime: 2 },
      { name: "a", unlockTime: 1 },
    ],
  });
  await acknowledgeAll(f);
  await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  await acknowledgeAll(f);
  assert.equal(f.requests.length, 1);
  assert.equal(f.records.size, 0);
});

test("a reset forgets the acknowledged payload so the same unlocks sync again", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  await acknowledgeAll(f);
  await f.achievementSyncWorker.cancelGame("steam:620");
  f.AchievementMemoryStore.set("steam", "620", {
    achievements: [],
    unlockedAchievements: [],
  });
  await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  assert.equal(f.records.size, 1);
  [...f.records.values()][0]!.nextAttemptAt = 0;
  await acknowledgeAll(f);
  assert.equal(f.requests.length, 2);
  assert.equal(f.records.size, 0);
});

test("the worker wakes itself to send coalesced unlocks when the window ends", async (t) => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  await f.mergeAchievements(f.game, [{ name: "N0", unlockTime: 1 }], true);
  await f.untilRequest(1);
  f.requests[0]!.gate.resolve(undefined);
  await acknowledgeAll(f);
  await f.mergeAchievements(f.game, [{ name: "N1", unlockTime: 2 }], true);
  await acknowledgeAll(f);
  assert.equal(f.requests.length, 1);
  t.mock.timers.tick(4_000);
  await acknowledgeAll(f);
  assert.equal(f.requests.length, 1);
  t.mock.timers.tick(1_000);
  await f.untilRequest(2);
  assert.deepEqual(
    f.requests[1]!.body.achievements.map((item) => item.name),
    ["N0", "N1"]
  );
  f.requests[1]!.gate.resolve(undefined);
  await acknowledgeAll(f);
  assert.equal(f.records.size, 0);
});

test("a rejected list is not resent in the same session but is retried after a restart", async (t) => {
  const f = await fixture(t);
  await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  await f.untilRequest(1);
  f.requests[0]!.gate.reject({
    isAxiosError: true,
    response: { status: 400, headers: {} },
  });
  await acknowledgeAll(f);
  const rejected = [...f.records.values()][0]!;
  assert.equal(rejected.terminal, true);
  for (let tick = 0; tick < 16; tick++)
    await f.mergeAchievements(f.game, rewrittenUnlocks, true);
  assert.equal([...f.records.values()][0], rejected);
  const restarted = new f.AchievementSyncWorker();
  t.after(() => restarted.stop());
  await restarted.enqueue({
    context: f.state.context!,
    gameKey: "steam:620",
    remoteId: f.game.remoteId!,
    shop: "steam",
    objectId: "620",
    achievements: rewrittenUnlocks,
  });
  const retried = [...f.records.values()][0]!;
  assert.notEqual(retried.revision, rejected.revision);
  assert.equal(retried.terminal, undefined);
  retried.nextAttemptAt = 0;
  void restarted.trigger();
  await f.untilRequest(2);
  f.requests[1]!.gate.resolve(undefined);
  await acknowledgeAll(f);
  assert.equal(f.records.size, 0);
});
