import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import * as protocol from "./auth-protocol.js";
import * as syncProtocol from "./sync-protocol.js";
import * as constants from "./constants.js";
import * as normalizer from "./library-normalizer.js";
import * as policy from "./playtime-policy.js";
import * as queue from "../library-sync/library-write-queue.js";
import { mergeImportedProfileGame } from "../library-sync/merge-imported-profile-game.js";
import { EpicSyncOrchestrator } from "./sync-orchestrator.js";
import type { EpicConnectionState } from "../../../types/epic-integration.types";
import type { Game } from "@types";

const connection = {
  connected: true as const,
  connectionId: "AbCdEfG1",
  epicAccountId: "a".repeat(32),
  displayName: "Test",
  connectedAt: "2026-10-12T00:00:00Z",
};
const auth = {
  environment: "https://api.test",
  userId: "HydraA",
  generation: 1,
};
const objectId = "Namespace:Item";
const game: Game = {
  title: "Game",
  shop: "epic",
  objectId,
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  playTimeInMilliseconds: 10,
  steamPlayTimeInMilliseconds: 20,
  epicPlayTimeInMilliseconds: 1000,
  remoteId: "Remote1",
  isDeleted: false,
  lastTimePlayed: null,
  hasActiveEpicImport: true,
  source: "epic",
  epicImportScope: {
    environment: auth.environment,
    userId: auth.userId,
    connectionId: connection.connectionId,
  },
};
function fixture() {
  const state = {
    current: true,
    game: { ...game },
    seconds: 100,
    ownerReads: 0,
    starts: 0,
    journal: null as import("./sync-orchestrator").EpicSyncJournal | null,
    deletedJournals: 0,
    requested: [] as string[],
    playtimeReads: 0,
    puts: [] as unknown[],
    ownerConnectionId: connection.connectionId,
    aliases: ["Artifact"],
    sourceGate: Promise.resolve(),
    waitGate: Promise.resolve(),
  };
  const connectionState: EpicConnectionState = {
    hydraLoggedIn: true,
    hydraUserId: auth.userId,
    connection,
    verification: "confirmed",
    sessionState: "ready",
    availability: { available: true },
    operation: null,
  };
  const timers = new Map<object, { callback: () => void; delay: number }>();
  const events: string[] = [];
  const modules: Record<string, unknown> = {
    "node:crypto": {
      createHash: () => ({ update: () => ({ digest: () => "scope-key" }) }),
    },
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      db: {
        get: async () => state.journal,
        put: async (
          _key: string,
          value: import("./sync-orchestrator").EpicSyncJournal
        ) => {
          state.journal = value;
        },
        del: async () => {
          state.deletedJournals++;
          state.journal = null;
        },
      },
      gamesSublevel: {
        get: async () => ({ ...state.game }),
        put: async (_key: string, value: Game) => {
          state.game = value;
        },
      },
    },
    "../hydra-api": {
      HydraApi: {
        post: async (_url: string) => {
          state.requested.push(_url);
          if (_url.endsWith("/sync")) state.starts++;
          return { syncRunId: "RunAbCd1" };
        },
        getAuthContext: () => auth,
        isAuthContextCurrent: () => state.current,
        get: async (
          _url: string,
          _params: unknown,
          options: { signal?: AbortSignal }
        ) => {
          state.requested.push(_url);
          if (options.signal?.aborted)
            throw new protocol.EpicIntegrationError("operation-cancelled");
          state.ownerReads++;
          return {
            id: "Remote1",
            shop: "epic",
            objectId,
            hasActiveEpicImport: true,
            runtimeByPlatform: { hydra: 0, steam: 0, epic: state.seconds },
            epicImport: {
              connectionId: state.ownerConnectionId,
              artifactIds: state.aliases,
            },
          };
        },
        put: async (
          _url: string,
          body: unknown,
          options: { signal?: AbortSignal }
        ) => {
          if (options.signal?.aborted)
            throw new protocol.EpicIntegrationError("operation-cancelled");
          state.puts.push(body);
        },
      },
    },
    "../window-manager": {
      WindowManager: {
        appWindows: [
          {
            isDestroyed: () => false,
            webContents: { send: (event: string) => events.push(event) },
          },
        ],
      },
    },
    "../library-sync/merge-with-remote-games": {
      mergeWithRemoteGames: async () => true,
    },
    "../library-sync/merge-imported-profile-game": { mergeImportedProfileGame },
    "../library-sync/library-write-queue": queue,
    "./sync-orchestrator": { EpicSyncOrchestrator },
    "./session-provider": {
      EpicSessionProvider: class {
        token = async () => "private";
        use = async (
          _auth: unknown,
          _connection: unknown,
          _signal: AbortSignal,
          task: (runner: { library(): Promise<unknown[]> }) => Promise<unknown>
        ) => task({ library: async () => [[], []] });
      },
    },
    "./playtime-source": {
      EpicPlaytimeSource: class {
        invalidate() {
          return undefined;
        }
        async get() {
          state.playtimeReads++;
          await state.sourceGate;
          return new Map(
            state.seconds < 0 ? [] : [["Artifact", state.seconds]]
          );
        }
      },
    },
    "./auth-protocol": protocol,
    "./sync-protocol": syncProtocol,
    "./constants": constants,
    "./library-normalizer": normalizer,
    "./playtime-policy": policy,
    "./session-attribution": { isEpicInstallExecutable: async () => false },
    "./import-cleanup": {
      matchesEpicImportScope: (
        game: Game,
        auth: { userId: string; environment: string },
        id: string
      ) =>
        game.epicImportScope?.userId === auth.userId &&
        game.epicImportScope.environment === auth.environment &&
        game.epicImportScope.connectionId === id,
    },
  };
  const module = {} as typeof import("./sync-runtime");
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("./sync-runtime.ts", import.meta.url), "utf8"),
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
        modules[name] ?? assert.fail(`Unexpected dependency ${name}`),
      AbortController,
      AbortSignal,
      Map,
      Set,
      Date,
      JSON,
      queueMicrotask,
      setTimeout: (callback: () => void, delay: number) => {
        const key = {};
        timers.set(key, { callback, delay });
        return key;
      },
      clearTimeout: (key: object) => timers.delete(key),
    }
  );
  const runtime = new module.EpicSyncRuntime(
    {} as never,
    "private",
    async () => "binary",
    async () => connectionState,
    () => connectionState
  );
  const executionWait = runtime.orchestrator.wait.bind(runtime.orchestrator);
  runtime.orchestrator.wait = async () => state.waitGate;
  const fire = (delay: number) => {
    for (const [key, timer] of timers)
      if (timer.delay === delay) {
        timers.delete(key);
        timer.callback();
      }
  };
  return { runtime, state, timers, events, fire, executionWait };
}
test("individual sync rehydrates owner aliases after restart and preserves Hydra", async () => {
  const f = fixture();
  assert.equal(await f.runtime.syncGame(objectId), 100);
  assert.equal(f.state.ownerReads, 2);
  assert.equal(f.state.playtimeReads, 1);
  assert.equal(f.state.game.playTimeInMilliseconds, 10);
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 100000);
  assert.equal(f.state.game.lastTimePlayed, null);
  assert.equal(
    JSON.stringify(f.state.puts[0]),
    JSON.stringify({
      connectionId: connection.connectionId,
      artifactIds: ["Artifact"],
      playTimeInSeconds: 100,
    })
  );
});
test("individual sync does not publish metadata belonging to an old connection", async () => {
  const f = fixture();
  f.state.ownerConnectionId = "OldLink1";
  assert.equal(await f.runtime.syncGame(objectId), null);
  assert.equal(f.state.puts.length, 0);
  assert.equal(f.state.playtimeReads, 0);
});
test("missing history never sends a zero update", async () => {
  const f = fixture();
  f.state.seconds = -1;
  assert.equal(await f.runtime.syncGame(objectId), null);
  assert.equal(f.state.puts.length, 0);
  assert.equal(f.state.game.epicPlayTimeInMilliseconds, 1000);
});
test("individual sync coalesces same game and validates context after collection", async () => {
  const f = fixture();
  let release!: () => void;
  f.state.sourceGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = f.runtime.syncGame(objectId),
    b = f.runtime.syncGame(objectId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.playtimeReads, 1);
  f.state.current = false;
  release();
  assert.deepEqual(await Promise.all([a, b]), [null, null]);
  assert.equal(f.state.puts.length, 0);
});
test("page sync waiting on full sync rechecks a removed import", async () => {
  const f = fixture();
  let release!: () => void;
  f.state.waitGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = f.runtime.syncGame(objectId);
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.state.game.hasActiveEpicImport = false;
  release();
  assert.equal(await result, null);
  assert.equal(f.state.puts.length, 0);
});
test("exit scheduling uses both delays and waits for the first result before deduplication", async () => {
  const f = fixture();
  let release!: (seconds: number | null) => void;
  const first = new Promise<number | null>((resolve) => {
    release = resolve;
  });
  const calls: { fresh: boolean; previous?: number }[] = [];
  f.runtime.syncGame = async (_id, fresh = false, previous) => {
    calls.push({ fresh, previous });
    return calls.length === 1 ? first : 100;
  };
  f.runtime.scheduleExit(game);
  f.fire(constants.EPIC_EXIT_SYNC_DELAYS_MS[0]);
  f.fire(constants.EPIC_EXIT_SYNC_DELAYS_MS[1]);
  await Promise.resolve();
  assert.equal(calls.length, 1);
  release(100);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].previous, 100);
  assert.equal(calls[1].fresh, true);
});
test("reopening cancels a delayed second exit update already waiting for the first", async () => {
  const f = fixture();
  let release!: (seconds: number | null) => void;
  const first = new Promise<number | null>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  f.runtime.syncGame = async () => {
    calls++;
    return first;
  };
  f.runtime.scheduleExit(game);
  f.fire(constants.EPIC_EXIT_SYNC_DELAYS_MS[0]);
  f.fire(constants.EPIC_EXIT_SYNC_DELAYS_MS[1]);
  f.runtime.cancelExit(objectId);
  release(100);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test("a legacy UUID journal is discarded before creating a Hashid execution", async () => {
  const f = fixture();
  const uuid = "00000000-0000-4000-8000-000000000001";
  f.state.journal = { syncRunId: uuid, totalChunks: 1, mergePending: true };
  await f.runtime.start(connection.connectionId);
  await f.executionWait();
  assert.equal(f.state.starts, 1);
  assert.equal(f.state.deletedJournals, 2);
  assert.equal(f.state.journal, null);
  assert.equal(
    f.state.requested.some((url) => url.includes(uuid)),
    false
  );
  assert.equal(
    f.state.game.epicPlayTimeInMilliseconds,
    game.epicPlayTimeInMilliseconds
  );
});
