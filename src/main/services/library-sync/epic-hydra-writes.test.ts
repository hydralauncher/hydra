import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import * as queue from "./library-write-queue.js";
import * as requests from "./game-request-queue.js";
import * as playtime from "../../../shared/playtime.js";
import * as running from "../game-running-state.js";
import { createGameRecordUpdater } from "../game-record-updater-core.js";
import type { Game } from "@types";

const auth = {
    environment: "https://api.test",
    userId: "HydraA",
    generation: 1,
  },
  key = "epic:Namespace:Item";
const base: Game = {
  shop: "epic",
  objectId: "Namespace:Item",
  title: "Game",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  remoteId: "Remote1",
  playTimeInMilliseconds: 500,
  lastTimePlayed: null,
  isDeleted: false,
  source: "hydra",
  epicPlayTimeInMilliseconds: 3000,
  hasActiveEpicImport: true,
  favorite: true,
};
function fixture() {
  const state = {
    game: { ...base },
    others: [] as Game[],
    current: true,
    postFail: false,
    putFail: false,
    putError: new Error("offline"),
    postGate: Promise.resolve(),
    putGate: Promise.resolve(),
    now: 60_000,
    acceptedPlayTimeInSeconds: 0,
    calls: [] as { method: string; body: unknown }[],
  };
  const modules: Record<string, unknown> = {
    "./game-request-queue": requests,
    "./library-write-queue": queue,
    "@shared": playtime,
    "../hydra-api": {
      HydraApi: {
        getAuthContext: () => auth,
        isAuthContextCurrent: () => state.current,
        post: async (_path: string, body: unknown) => {
          state.calls.push({ method: "post", body });
          await state.postGate;
          if (state.postFail) throw new Error("offline");
          return {
            id: "Remote2",
            playTimeInMilliseconds: 100000,
            runtimeByPlatform: { hydra: 0, steam: 0, epic: 100 },
          };
        },
        put: async (_path: string, body: unknown) => {
          state.calls.push({ method: "put", body });
          await state.putGate;
          if (state.putFail) throw state.putError;
          state.acceptedPlayTimeInSeconds +=
            (body as { playTimeDeltaInSeconds?: number })
              .playTimeDeltaInSeconds ?? 0;
          return {};
        },
      },
    },
    "lodash-es": {
      chunk: (values: unknown[], size: number) =>
        Array.from({ length: Math.ceil(values.length / size) }, (_, i) =>
          values.slice(i * size, (i + 1) * size)
        ),
    },
    "../epic/import-cleanup": { clearStaleEpicImports: async () => {} },
    "./merge-with-remote-games": { mergeWithRemoteGames: async () => true },
    "../window-manager": { WindowManager: { mainWindow: null } },
    "../achievements/achievement-watcher-manager": {
      AchievementWatcherManager: { preSearchAchievements: () => {} },
    },
    "./remote-library-sync-state": {
      trackRemoteLibrarySync: (task: () => Promise<void>) => task(),
    },
    "@main/level": {
      levelKeys: {
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
      gamesSublevel: {
        values: () => ({ all: async () => [state.game, ...state.others] }),
        getMany: async (keys: string[]) =>
          keys.map((key) =>
            [state.game, ...state.others].find(
              (game) => `${game.shop}:${game.objectId}` === key
            )
          ),
        get: async () => ({ ...state.game }),
        put: async (_key: string, value: Game) => {
          state.game = value;
        },
      },
    },
  };
  const load = <T>(
    name: string,
    dependencies = modules,
    extraSource = ""
  ): T => {
    const module = {};
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync(new URL(name, import.meta.url), "utf8") + extraSource,
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
        }
      ).outputText,
      {
        exports: module,
        require: (name: string) =>
          dependencies[name] ?? assert.fail(`Unexpected dependency ${name}`),
        Date,
        Math,
        process,
        performance: { now: () => state.now },
      }
    );
    return module as T;
  };
  const sync = {
    state,
    create: load<typeof import("./create-game")>("./create-game.ts").createGame,
    batch: load<typeof import("./upload-games-batch")>(
      "./upload-games-batch.ts"
    ).uploadGamesBatch,
    track: load<typeof import("./update-game-playtime")>(
      "./update-game-playtime.ts"
    ).trackGamePlaytime,
  };
  const watcher = () => {
    const store = (
      modules["@main/level"] as {
        gamesSublevel: Parameters<typeof createGameRecordUpdater>[0];
      }
    ).gamesSublevel;
    const update = createGameRecordUpdater(store);
    return load<{
      onOpenGame(game: Game, matchedPath: string): Promise<void>;
      onCloseGame(game: Game): Promise<unknown>;
    }>(
      "../process-watcher.ts",
      {
        "./library-sync/library-write-queue": queue,
        "./library-sync": {
          createGame: sync.create,
          trackGamePlaytime: sync.track,
        },
        "./game-running-state": running,
        "./game-record-updater": {
          updateGameRecord: (...args: Parameters<typeof update>) =>
            queue.libraryWriteQueue.run(() => update(...args)),
        },
        "./hydra-api": modules["../hydra-api"],
        "@main/level": {
          ...(modules["@main/level"] as object),
          db: { get: async () => null },
        },
        "./epic": {
          resolveEpicSessionPolicy: async () => ({
            countHydraPlaytime: true,
            syncEpicOnExit: false,
          }),
          cancelEpicGameExitSync: () => {},
        },
        "./window-manager": {
          WindowManager: { closeGameLauncherWindow: () => {} },
        },
        "./logger": { networkLogger: { info: () => {} } },
        "./power-save-blocker": {
          PowerSaveBlockerManager: { markGameClosed: () => {} },
        },
        "./achievements/achievement-watcher-manager": {
          AchievementWatcherManager: { syncGameAchievementFiles: () => {} },
        },
        "./achievements/metadata-export": {
          abortAchievementMetadataExport: () => {},
        },
        "@main/constants": { INTERVALS: { processWatcher: 1000 } },
        "./launched-game-pids": { launchedGamePids: new Map() },
        "./steam-integration/steam-game-exit-sync": {
          cancelSteamGameExitSync: () => {},
          shouldScheduleSteamGameExitSync: () => false,
        },
        "./cloud-save": {
          getCloudSaveAutomaticSyncMode: async () => "off",
          shouldRunLegacyAutomaticCloudSave: () => false,
          shouldRunV2AutomaticCloudSave: () => false,
        },
        "./linux-game-capture-session": {
          prepareLinuxGameCaptureSession: async () => {},
          stopLinuxGameCaptureSession: () => {},
        },
        "./game-executables": {
          GameExecutables: { ensureLoaded: async () => {} },
        },
        "@main/helpers/update-executable-path": {},
        axios: {},
        "./cloud-sync": {},
        "node:path": {},
        "./wine": {},
        "./native-addon": {},
        "./emulators/emulator-session-tracker": {},
        "./game-launcher-status": { markGameLauncherGameDetected: () => {} },
        "./process-watcher-scan": {},
        "./linux-process-match": {},
        "@main/helpers/windows-batch-command": {},
        "./steam-integration/steam-library-executable": {
          isSteamAppExecutable: async () => false,
        },
        "./steam-integration/steam-playtime": {
          resolveActiveSteamImport: async () => false,
          resolveSteamSessionPlaytimePolicy: () => ({
            countHydraPlaytime: true,
            syncSteamOnExit: false,
          }),
        },
      },
      "\nexport { onOpenGame, onCloseGame };"
    );
  };
  return { ...sync, watcher };
}
test("creation never copies Epic aggregate into Hydra", async () => {
  const f = fixture();
  f.state.game.playTimeInMilliseconds = 0;
  await f.create(f.state.game);
  assert.equal(f.state.game.playTimeInMilliseconds, 0);
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 100000);
  assert.equal(f.state.game.favorite, true);
  assert.equal(
    (f.state.calls[0].body as { playTimeInMilliseconds: number })
      .playTimeInMilliseconds,
    0
  );
});
test("an exclusively imported Epic game cannot be claimed by generic creation", async () => {
  const f = fixture();
  f.state.game.source = "epic";
  await f.create(f.state.game);
  assert.equal(f.state.calls.length, 0);
  assert.equal(f.state.game.source, "epic");
});
test("failed explicit creation retains a retryable Hydra claim without losing imports/preferences", async () => {
  const f = fixture();
  f.state.postFail = true;
  await assert.rejects(f.create(f.state.game));
  assert.equal(f.state.game.source, "hydra");
  assert.equal(f.state.game.remoteId, null);
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 3000);
  assert.equal(f.state.game.playTimeInMilliseconds, 500);
  assert.equal(f.state.game.favorite, true);
});
test("old creation response cannot overwrite reset Hydra runtime or a new context", async () => {
  const f = fixture();
  let release!: () => void;
  f.state.postGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = f.create(f.state.game);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.state.game.playTimeInMilliseconds = 0;
  queue.markHydraPlaytimeChanged(key);
  release();
  await result;
  assert.equal(f.state.game.playTimeInMilliseconds, 0);
  f.state.postGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stale = f.create(f.state.game);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.state.current = false;
  release();
  await assert.rejects(stale);
  assert.equal(f.state.game.playTimeInMilliseconds, 0);
});
test("heartbeat zero does not promote an Epic import, but a positive Hydra delta does", async () => {
  const f = fixture();
  f.state.game.source = "epic";
  await f.track(f.state.game, 0, new Date());
  assert.equal(f.state.game.source, "epic");
  await f.track(f.state.game, 1000, new Date());
  assert.equal(f.state.game.source, "hydra");
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 3000);
});
test("a tracking delta queued before reset is discarded after its revision changes", async () => {
  const f = fixture();
  let release!: () => void;
  const first = requests.gameRequestQueue.run(
    [key],
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    () => true
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stale = f.track(f.state.game, 10000, new Date());
  queue.markHydraPlaytimeChanged(key);
  release();
  await first;
  await stale;
  assert.equal(f.state.calls.length, 0);
});

test("a failed positive Hydra delta retains its claim and remote identity for retry", async () => {
  const f = fixture();
  f.state.game.source = "epic";
  f.state.putFail = true;
  await assert.rejects(f.track(f.state.game, 1000, new Date()));
  assert.equal(f.state.game.source, "hydra");
  assert.equal(f.state.game.remoteId, base.remoteId);
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 3000);
  assert.equal(f.state.game.playTimeInMilliseconds, 500);
  assert.equal(f.state.game.favorite, true);
});

for (const [name, error] of [
  ["network", new Error("offline")],
  ["timeout", Object.assign(new Error("timeout"), { code: "ECONNABORTED" })],
  [
    "rate limit",
    Object.assign(new Error("rate limit"), { response: { status: 429 } }),
  ],
  ["server", Object.assign(new Error("server"), { response: { status: 503 } })],
] as const) {
  for (const remoteId of [base.remoteId, null]) {
    test(`${name} tracking failure preserves ${remoteId === null ? "an unpublished" : "an existing"} Hydra claim and local data`, async () => {
      const f = fixture();
      f.state.game = { ...base, source: "epic", remoteId };
      f.state.putFail = true;
      f.state.putError = error;
      const latest = { ...f.state.game };
      await assert.rejects(
        f.track(f.state.game, 1000, new Date()),
        (actual) => actual === error
      );
      assert.deepEqual({ ...f.state.game }, { ...latest, source: "hydra" });
    });
  }
}

for (const shop of ["steam", "epic"] as const) {
  test(`${shop} close failure retries the pending delta on reopen without creating the game again`, async () => {
    const f = fixture();
    f.state.game = { ...base, shop, playTimeInMilliseconds: 900_000 };
    const gameKey = `${shop}:${base.objectId}`;
    const watcher = f.watcher();
    running.setGamePlaytime(gameKey, {
      firstTick: 0,
      lastTick: 30_000,
      lastSyncTick: 0,
      countHydraPlaytime: true,
    });
    try {
      f.state.putFail = true;
      await watcher.onCloseGame({ ...f.state.game });
      assert.equal(f.state.game.remoteId, base.remoteId);
      assert.equal(f.state.game.playTimeInMilliseconds, 930_000);
      assert.equal(f.state.game.unsyncedDeltaPlayTimeInMilliseconds, 60_000);
      assert.equal(f.state.acceptedPlayTimeInSeconds, 0);
      assert.equal(running.gamesPlaytime.has(gameKey), false);

      f.state.putFail = false;
      await watcher.onOpenGame({ ...f.state.game }, "game.exe");
      await new Promise<void>((resolve) => setImmediate(resolve));
      await queue.libraryWriteQueue.drain();
      assert.equal(f.state.game.unsyncedDeltaPlayTimeInMilliseconds, 0);
      assert.equal(f.state.game.playTimeInMilliseconds, 930_000);
      assert.equal(
        f.state.game.epicPlayTimeInMilliseconds,
        base.epicPlayTimeInMilliseconds
      );
      assert.equal(f.state.game.favorite, true);
      assert.equal(f.state.acceptedPlayTimeInSeconds, 60);
      assert.deepEqual(
        f.state.calls.map(({ method }) => method),
        ["put", "put"]
      );
      assert.deepEqual(
        f.state.calls.map(
          ({ body }) =>
            (body as { playTimeDeltaInSeconds: number }).playTimeDeltaInSeconds
        ),
        [60, 60]
      );
    } finally {
      running.clearGamesPlaytimeState();
    }
  });
}

test("a tracking failure after a context change does not write into the new account", async () => {
  const f = fixture();
  let release!: () => void;
  f.state.putGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.state.putFail = true;
  const tracking = f.track(f.state.game, 1000, new Date());
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.state.current = false;
  f.state.game = {
    ...base,
    remoteId: "NewAccount",
    playTimeInMilliseconds: 1234,
  };
  const latest = { ...f.state.game };
  release();
  await assert.rejects(tracking, /offline/);
  assert.deepEqual(f.state.game, latest);
});

test("Hydra batch excludes exclusive Epic games and uploads only the Hydra portion in inventory order", async () => {
  const f = fixture();
  f.state.game.source = "epic";
  f.state.game.remoteId = null;
  f.state.others = [
    {
      ...base,
      objectId: "Namespace:Hydra",
      remoteId: null,
      source: "hydra",
      playTimeInMilliseconds: 1200,
    },
    {
      ...base,
      shop: "steam",
      objectId: "620",
      remoteId: null,
      source: "hydra",
      playTimeInMilliseconds: 3400,
      steamPlayTimeInMilliseconds: 50000,
    },
  ];
  await f.batch();
  assert.equal(f.state.calls.length, 1);
  const payload = f.state.calls[0].body as {
    objectId: string;
    playTimeInMilliseconds: number;
  }[];
  assert.deepEqual(
    Array.from(payload, (game) => game.objectId),
    ["Namespace:Hydra", "620"]
  );
  assert.deepEqual(
    Array.from(payload, (game) => game.playTimeInMilliseconds),
    [1200, 3400]
  );
  assert.equal(f.state.game.source, "epic");
});

test("a queued batch rereads the Hydra reset rather than uploading its old absolute total", async () => {
  const f = fixture();
  f.state.game.remoteId = null;
  let release!: () => void;
  const block = requests.gameRequestQueue.run(
    [key],
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    () => true
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const uploading = f.batch();
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.state.game.playTimeInMilliseconds = 0;
  queue.markHydraPlaytimeChanged(key);
  release();
  await block;
  await uploading;
  assert.equal(
    (f.state.calls[0].body as { playTimeInMilliseconds: number }[])[0]
      .playTimeInMilliseconds,
    0
  );
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 3000);
});
