import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { EpicIntegrationError, isRecord } from "./auth-protocol.ts";
import {
  EpicIntegrationCore,
  type EpicAuthContext,
} from "./integration-core.ts";
import { EpicConnectionStore } from "./store.ts";
import { connection, deferred, MemoryDatabase } from "./store-test-helpers.ts";
import type { EpicConnection } from "../../../types/epic-integration.types";
import type { Download, Game } from "../../../types/level.types";
import { Downloader } from "../../../shared/constants.js";
import * as managedPlatform from "./managed-platform.js";
import type { EpicSaveSession } from "./cloud-saves";
import type { PreparedEpicLinuxContext } from "./linux-runtime";

function fixture(
  t: TestContext,
  options: { linux?: boolean; platform?: NodeJS.Platform } = {}
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-lifecycle-"));
  const stores: EpicConnectionStore[] = [];
  const localOwner = {
    environment: "https://api.test",
    userId: "user",
    epicAccountId: "a".repeat(32),
  };
  const localSaveSession = {
    objectId: "Namespace:Item",
    installed: {
      version: "build-1",
      installPath: path.join(root, "installed"),
    },
    target: {
      owner: localOwner,
      artifactId: "Artifact",
      platform: "Windows",
    },
  } as EpicSaveSession;
  const toolContext = {
    winePrefixPath: path.join(root, "prepared-prefix"),
  } as PreparedEpicLinuxContext;
  const state = {
    cleanup: async () => {},
    open: async () => {},
    cleanupCalls: 0,
    refreshHooks: 0,
    subscriptions: 0,
    unsubscriptions: 0,
    context: null as EpicAuthContext | null,
    connection: { connected: false } as EpicConnection,
    events: [] as string[],
    merge: async () => false,
    downloads: [] as Download[],
    games: [] as Game[],
    reconciledGames: [] as Game[][],
    preparedLinux: [] as unknown[],
    localSaveSession,
    captureOwnerCurrent: true,
    saveSessionCurrent: true,
    saveCaptures: [] as Array<{
      objectId: string;
      winePrefixPath: string | undefined;
      localOnly: boolean;
    }>,
    runtimePreparations: [] as Array<{
      game: Game;
      target: EpicSaveSession["target"];
      offline?: boolean;
      buildVersion?: string;
      installPath?: string;
    }>,
    toolContext,
    toolTreeExit: Promise.resolve(),
    toolTermination: Promise.resolve(),
    toolLaunchFailure: null as Error | null,
    toolTerminationFailure: null as Error | null,
    toolLeaseReleases: 0,
    managedSessionActive: false,
    warnings: [] as string[],
    downloadOptions: null as
      | ConstructorParameters<
          typeof import("./download").EpicDownloadService
        >[0]
      | null,
    activeDownloadId: null as string | null,
    managedEvents: [] as string[],
    managedStopGate: Promise.resolve(),
    saveStopGate: Promise.resolve(),
    reportDrainGate: Promise.resolve(),
    reportConfirmed: null as
      | ConstructorParameters<
          typeof import("./playtime-reporter").EpicPlaytimeReporter
        >[0]["confirmed"]
      | null,
  };
  const modules: Record<string, unknown> = {
    "./managed-platform": managedPlatform,
    "../library-sync/library-write-queue": {
      setEpicLibraryConnection: () => undefined,
    },
    "./sync-runtime": {
      EpicSyncRuntime: class {
        source = {
          invalidate() {
            return undefined;
          },
          clearCache() {
            state.managedEvents.push("playtime-cache-cleared");
          },
        };
        session = {
          serialize: (task: () => Promise<unknown>) => task(),
          setRefreshOperation: (operation: unknown) => {
            assert.equal(typeof operation, "function");
            state.refreshHooks++;
          },
        };
        orchestrator = {
          getState: () => ({ status: "idle" }),
          abortAndWait: async () => {},
        };
        startup = async () => {};
        authenticated = async () => {};
        current = (target: {
          auth: EpicAuthContext;
          connection: typeof connection;
        }) =>
          target.auth.userId === state.context?.userId &&
          target.auth.environment === state.context?.environment &&
          target.auth.generation === state.context?.generation &&
          state.connection.connected &&
          target.connection.connectionId === state.connection.connectionId;
        syncGame = async (objectId: string, fresh: boolean) => {
          assert.equal(fresh, true);
          state.managedEvents.push(`fresh-playtime:${objectId}`);
        };
        invalidate() {
          return undefined;
        }
        stop = async () => {};
      },
    },
    "./import-cleanup": {
      clearEpicImports: async () => {
        state.events.push("cleanup");
      },
      clearStaleEpicImports: async () => 0,
    },
    "../library-sync/merge-with-remote-games": {
      mergeWithRemoteGames: async () => {
        state.events.push("merge");
        return state.merge();
      },
    },
    electron: { app: { getPath: () => root } },
    "node:fs": fs,
    "node:path": path,
    "../hydra-api": {
      HydraApi: {
        getAuthContext: () => state.context,
        isAuthContextCurrent: (context: EpicAuthContext) =>
          context === state.context,
        get: async () => state.connection,
        delete: async () => {
          state.connection = { connected: false };
        },
        onAuthContextChanged: () => {
          state.subscriptions++;
          return () => {
            state.unsubscriptions++;
          };
        },
      },
    },
    "../legendary": {
      Legendary: {
        getBinaryPath: () => null,
        getManagedCommand: () => assert.fail("unexpected managed invocation"),
      },
    },
    "../window-manager": {
      WindowManager: {
        mainWindow: null,
        sendToAppWindows: (channel: string) => state.events.push(channel),
        sendDownloadsUpdated: () => {},
      },
    },
    "./auth-window": {
      openEpicAuthWindow: () => assert.fail("unexpected window"),
    },
    "./auth-protocol": { EpicIntegrationError, isRecord },
    "./integration-core": { EpicIntegrationCore },
    "./legendary-auth": {
      cleanupEpicTemporarySessions: async () => {
        state.cleanupCalls++;
        await state.cleanup();
      },
      LegendaryAuthRunner: {
        create: () => assert.fail("unexpected Legendary invocation"),
      },
    },
    "./store": {
      EpicConnectionStore: class extends EpicConnectionStore {
        constructor(
          options: ConstructorParameters<typeof EpicConnectionStore>[0]
        ) {
          super({
            ...options,
            createDatabase: () => {
              const db = new MemoryDatabase();
              db.onOpen = () => state.open();
              return db;
            },
          });
          stores.push(this);
        }
      },
    },
    "../../level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesSublevel: {
        get: async (id: string) =>
          state.games.find((game) => `${game.shop}:${game.objectId}` === id),
        values: () => ({ all: async () => state.games }),
      },
      downloadsSublevel: {
        get: async (id: string) =>
          state.downloads.find(
            (entry) => `${entry.shop}:${entry.objectId}` === id
          ),
        values: () => ({ all: async () => state.downloads }),
        put: async (id: string, value: Download) => {
          state.downloads = state.downloads.map((entry) =>
            `${entry.shop}:${entry.objectId}` === id ? value : entry
          );
          state.managedEvents.push("paused");
        },
      },
    },
    "../game-record-updater": { updateGameRecord: async () => undefined },
    "../download-orchestrator": { DownloadOrchestrator: {} },
    "../download/download-manager": {
      DownloadManager: {
        getActiveDownloadId: () => state.activeDownloadId,
        pauseDownload: async () => {
          state.activeDownloadId = null;
          state.managedEvents.push("slot-released");
        },
      },
    },
    "../disk-usage": { getDiskUsage: async () => null },
    "../game-running-state": { isGameRunning: () => false },
    "../../../shared/constants": { Downloader },
    "./legendary-managed-runtime": {
      configureManagedEpicProcessSupervisor: () => {},
      LegendaryManagedRuntime: class {
        stop = async () => {
          state.managedEvents.push("process-stopping");
          await state.managedStopGate;
          state.managedEvents.push("process-stopped");
        };
        cleanupCredentials = async () => {
          state.managedEvents.push("credentials-cleared");
        };
      },
    },
    "./installation": {
      EpicInstallationService: class {
        confirmPrerequisites = async () => {
          state.managedEvents.push("prerequisites-confirmed");
        };
      },
    },
    "./cloud-save-source": { EpicCloudSaveSource: class {} },
    "./linux-runtime": {
      ensureEpicLinuxPrerequisites: async (input: unknown) => {
        state.preparedLinux.push(input);
        state.managedEvents.push("linux-prepared");
      },
      prepareEpicLinuxRuntime: async (
        game: Game,
        target: EpicSaveSession["target"],
        options: {
          offline?: boolean;
          buildVersion?: string;
          installPath?: string;
        }
      ) => {
        state.managedEvents.push("tool-context-prepared");
        state.runtimePreparations.push({
          game,
          target,
          offline: options.offline,
          buildVersion: options.buildVersion,
          installPath: options.installPath,
        });
        return state.toolContext;
      },
      acquireEpicLinuxPrefixSession: async (
        context: PreparedEpicLinuxContext
      ) => {
        assert.equal(context, state.toolContext);
        state.managedEvents.push("tool-lease-acquired");
        return {
          id: "tool-lease",
          release: () => {
            state.toolLeaseReleases++;
            state.managedEvents.push("tool-lease-released");
          },
        };
      },
      openEpicLinuxWinetricks: async (context: PreparedEpicLinuxContext) => {
        assert.equal(context, state.toolContext);
        state.managedEvents.push("tool-opened");
        if (state.toolLaunchFailure) throw state.toolLaunchFailure;
        return {
          waitForTreeExit: () => {
            state.managedEvents.push("tool-tree-wait");
            return state.toolTreeExit;
          },
          terminate: async () => {
            state.managedEvents.push("tool-terminating");
            await state.toolTermination;
            if (state.toolTerminationFailure)
              throw state.toolTerminationFailure;
          },
        };
      },
    },
    "./ownership-token-reconciliation": {
      reconcileEpicLinuxOwnershipTokens: async (games: Game[]) => {
        state.reconciledGames.push(games);
      },
    },
    "../logger": {
      logger: {
        warn: (message: string) => state.warnings.push(message),
        info: () => {},
      },
    },
    "./timing": {
      configureEpicTiming: () => {},
      withEpicTiming: (_stage: string, task: () => unknown) => task(),
    },
    "./playtime-reporter": {
      EpicPlaytimeReporter: class {
        constructor(
          options: ConstructorParameters<
            typeof import("./playtime-reporter").EpicPlaytimeReporter
          >[0]
        ) {
          state.reportConfirmed = options.confirmed;
        }
        invalidate = () => {
          state.managedEvents.push("reports-aborted");
        };
        idle = async () => {};
        drain = async () => {
          state.managedEvents.push("reports-draining");
          await state.reportDrainGate;
          state.managedEvents.push("reports-drained");
        };
        restoreAfterFailedShutdown = () => {
          state.managedEvents.push("reports-restored");
        };
      },
    },
    "./download": {
      EpicDownloadService: class {
        constructor(
          options: ConstructorParameters<
            typeof import("./download").EpicDownloadService
          >[0]
        ) {
          state.downloadOptions = options;
        }
        stop = async () => {};
        getOptions = async () => ({ options: [] });
      },
      setEpicDownloadService: () => {},
    },
    "./cloud-saves": {
      configureEpicCloudSaves: () => ({
        capture: async (
          objectId: string,
          _signal: AbortSignal,
          winePrefixPath: string | undefined,
          localOnly: boolean
        ) => {
          state.managedEvents.push("local-save-captured");
          state.saveCaptures.push({ objectId, winePrefixPath, localOnly });
          const game = state.games.find((entry) => entry.objectId === objectId);
          if (!state.captureOwnerCurrent || !game?.hasActiveEpicImport)
            throw Object.assign(new Error("game-not-owned"), {
              code: "game-not-owned",
            });
          return state.localSaveSession;
        },
        assertSessionCurrent: (session: EpicSaveSession) => {
          assert.equal(session, state.localSaveSession);
          state.managedEvents.push("tool-session-revalidated");
          if (!state.saveSessionCurrent)
            throw new EpicIntegrationError("operation-cancelled");
        },
        invalidate: async () => {
          state.managedEvents.push("saves-stopping");
          await state.saveStopGate;
          state.managedEvents.push("saves-stopped");
        },
      }),
    },
    "./launch": {
      configureEpicLaunch: () => {},
      clearManagedEpicSessions: () => {},
      hasManagedEpicSession: () => state.managedSessionActive,
    },
  };
  const integration = {} as typeof import("./index");
  const source = fs.readFileSync(
    new URL("./index.ts", import.meta.url),
    "utf8"
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  vm.runInNewContext(compiled.outputText, {
    exports: integration,
    require: (specifier: string) =>
      modules[specifier] ?? assert.fail(`Unexpected dependency: ${specifier}`),
    process: {
      ...process,
      platform: options.platform ?? (options.linux ? "linux" : "win32"),
    },
    queueMicrotask,
    AbortController,
  });
  t.after(async () => {
    await integration.shutdownEpicIntegration();
    await Promise.all(stores.map((store) => store.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { state, stores, integration };
}

test("macOS preserves the existing Epic credential refresh runner", async (t) => {
  const f = fixture(t, { platform: "darwin" });
  await f.integration.initializeEpicIntegration();
  assert.equal(f.state.refreshHooks, 0);
});

test("Windows and Linux configure the target runtime's central refresh", async (t) => {
  for (const platform of ["win32", "linux"] as const) {
    const f = fixture(t, { platform });
    await f.integration.initializeEpicIntegration();
    assert.equal(f.state.refreshHooks, 1);
  }
});

async function winetricksFixture(t: TestContext) {
  const f = fixture(t, { linux: true });
  const game = {
    shop: "epic",
    objectId: "Namespace:Item",
    hasActiveEpicImport: true,
    epicInstallation: {
      owner: f.state.localSaveSession.target.owner,
      artifactId: "Artifact",
      platform: "Windows",
    },
  } as Game;
  f.state.games.push(game);
  await f.integration.initializeEpicIntegration();
  f.state.managedEvents = [];
  return { ...f, game };
}

function failureGate() {
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}

test("managed Winetricks verifies the captured local owner before selecting its cached context and holds the prefix until the tool tree exits", async (t) => {
  const f = await winetricksFixture(t);
  const closed = deferred<void>();
  f.state.toolTreeExit = closed.promise;
  assert.equal(
    await f.integration.openManagedEpicWinetricks(f.game.objectId),
    true
  );
  assert.deepEqual(f.state.saveCaptures, [
    {
      objectId: f.game.objectId,
      winePrefixPath: undefined,
      localOnly: true,
    },
  ]);
  assert.equal(f.state.runtimePreparations[0].game, f.game);
  assert.equal(
    f.state.runtimePreparations[0].target,
    f.state.localSaveSession.target
  );
  assert.equal(f.state.runtimePreparations[0].offline, true);
  assert.equal(f.state.runtimePreparations[0].buildVersion, "build-1");
  assert.equal(
    f.state.runtimePreparations[0].installPath,
    f.state.localSaveSession.installed.installPath
  );
  assert.deepEqual(f.state.managedEvents, [
    "local-save-captured",
    "tool-context-prepared",
    "tool-lease-acquired",
    "tool-session-revalidated",
    "tool-opened",
    "tool-tree-wait",
  ]);
  assert.equal(f.state.toolLeaseReleases, 0);
  closed.resolve();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.state.toolLeaseReleases, 1);
  assert.equal(f.state.managedEvents.includes("tool-terminating"), false);
});

test("managed Winetricks rejects an invalid local owner or inactive import before using cached runtime context", async (t) => {
  const f = await winetricksFixture(t);
  f.state.captureOwnerCurrent = false;
  await assert.rejects(
    f.integration.openManagedEpicWinetricks(f.game.objectId),
    { code: "game-not-owned" }
  );
  f.state.captureOwnerCurrent = true;
  f.game.hasActiveEpicImport = false;
  await assert.rejects(
    f.integration.openManagedEpicWinetricks(f.game.objectId),
    { code: "game-not-owned" }
  );
  assert.equal(f.state.runtimePreparations.length, 0);
  assert.equal(f.state.toolLeaseReleases, 0);
});

test("managed Winetricks is Linux only and skips missing, deleted or already managed games", async (t) => {
  const windows = fixture(t);
  assert.equal(
    await windows.integration.openManagedEpicWinetricks("Namespace:Item"),
    false
  );
  assert.equal(windows.stores.length, 0);
  const f = await winetricksFixture(t);
  assert.equal(
    await f.integration.openManagedEpicWinetricks("Namespace:Missing"),
    false
  );
  f.game.isDeleted = true;
  assert.equal(
    await f.integration.openManagedEpicWinetricks(f.game.objectId),
    false
  );
  f.game.isDeleted = false;
  f.state.managedSessionActive = true;
  assert.equal(
    await f.integration.openManagedEpicWinetricks(f.game.objectId),
    false
  );
  assert.equal(f.state.saveCaptures.length, 0);
  assert.equal(f.state.runtimePreparations.length, 0);
});

test("managed Winetricks releases a lease after launch failure or final session invalidation", async (t) => {
  const f = await winetricksFixture(t);
  f.state.toolLaunchFailure = new Error("compatibility-launch-failed");
  await assert.rejects(
    f.integration.openManagedEpicWinetricks(f.game.objectId),
    /compatibility-launch-failed/
  );
  assert.equal(f.state.toolLeaseReleases, 1);
  f.state.toolLaunchFailure = null;
  f.state.saveSessionCurrent = false;
  await assert.rejects(
    f.integration.openManagedEpicWinetricks(f.game.objectId),
    { code: "operation-cancelled" }
  );
  assert.equal(f.state.toolLeaseReleases, 2);
  assert.equal(
    f.state.managedEvents.filter((event) => event === "tool-opened").length,
    1
  );
});

test("managed Winetricks waits for proven termination after inspection failure and retains the lease if cleanup fails", async (t) => {
  const f = await winetricksFixture(t);
  const closed = failureGate(),
    terminated = deferred<void>();
  f.state.toolTreeExit = closed.promise;
  f.state.toolTermination = terminated.promise;
  assert.equal(
    await f.integration.openManagedEpicWinetricks(f.game.objectId),
    true
  );
  closed.reject(new Error("cleanup-failed"));
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.state.managedEvents.includes("tool-terminating"), true);
  assert.equal(f.state.toolLeaseReleases, 0);
  terminated.resolve();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.state.toolLeaseReleases, 1);
  const failedTree = failureGate();
  f.state.toolTreeExit = failedTree.promise;
  f.state.toolTerminationFailure = new Error("cleanup-failed");
  assert.equal(
    await f.integration.openManagedEpicWinetricks(f.game.objectId),
    true
  );
  failedTree.reject(new Error("cleanup-failed"));
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.state.toolLeaseReleases, 1);
  assert.deepEqual(f.state.warnings, [
    "Epic compatibility tool cleanup remains pending",
  ]);
});

test("Linux startup reconciles ownership tokens without attaching compatibility preparation to downloads", async (t) => {
  const f = fixture(t, { linux: true });
  f.state.games = [{ shop: "epic", objectId: "Namespace:Item" }] as Game[];
  await f.integration.initializeEpicIntegration();
  assert.deepEqual(f.state.reconciledGames, [f.state.games]);
  assert.ok(f.state.downloadOptions);
  assert.equal("prepareLinuxInstallation" in f.state.downloadOptions, false);
  assert.equal(f.state.preparedLinux.length, 0);
  await f.integration.initializeEpicIntegration();
  assert.equal(f.state.reconciledGames.length, 1);
});

test("Windows startup skips Linux reconciliation and preserves native prerequisite finalization", async (t) => {
  const f = fixture(t);
  await f.integration.initializeEpicIntegration();
  assert.ok(f.state.downloadOptions);
  assert.equal("prepareLinuxInstallation" in f.state.downloadOptions, false);
  assert.equal(f.state.reconciledGames.length, 0);
});

test("shutdown during startup cleanup prevents late database creation and subscription", async (t) => {
  const f = fixture(t),
    started = deferred<void>(),
    release = deferred<void>();
  f.state.cleanup = async () => {
    started.resolve();
    await release.promise;
  };
  const initializing = f.integration.initializeEpicIntegration();
  await started.promise;
  await f.integration.shutdownEpicIntegration();
  release.resolve();
  await initializing;
  await f.integration.initializeEpicIntegration();
  assert.equal(f.stores.length, 0);
  assert.equal(f.state.subscriptions, 0);
  assert.equal(f.state.cleanupCalls, 1);
  assert.throws(() => f.integration.getEpicConnection(), {
    code: "operation-cancelled",
  });
});

test("initial open failure is sanitized, retryable and shutdown unsubscribes", async (t) => {
  const f = fixture(t);
  let opens = 0;
  f.state.open = async () => {
    if (++opens === 1) throw new Error("secret-refresh");
  };
  await assert.rejects(f.integration.initializeEpicIntegration(), {
    code: "persistence-failed",
    message: "persistence-failed",
  });
  await f.integration.initializeEpicIntegration();
  assert.equal(opens, 2);
  assert.equal(f.stores.length, 1);
  assert.equal(f.state.subscriptions, 1);
  await f.integration.shutdownEpicIntegration();
  assert.equal(f.state.unsubscriptions, 1);
  await assert.rejects(f.stores[0].open(), { code: "persistence-failed" });
});

test("unlink refreshes app libraries after cleanup even if remote merge fails", async (t) => {
  const f = fixture(t);
  f.state.context = {
    environment: "http://localhost:3000",
    userId: "A",
    generation: 1,
  };
  f.state.connection = connection;
  await f.integration.initializeEpicIntegration();
  await f.integration.getEpicConnection();
  f.state.events.length = 0;

  assert.deepEqual(
    await f.integration.disconnectEpic(connection.connectionId),
    {
      ok: true,
    }
  );
  assert.deepEqual(
    f.state.events.filter((event) => event !== "on-epic-connection-changed"),
    ["cleanup", "merge", "on-library-batch-complete"]
  );
});

test("unlink cannot notify a different user's library after context changes", async (t) => {
  const f = fixture(t);
  f.state.context = {
    environment: "http://localhost:3000",
    userId: "A",
    generation: 1,
  };
  f.state.connection = connection;
  await f.integration.initializeEpicIntegration();
  await f.integration.getEpicConnection();
  f.state.events.length = 0;
  f.state.merge = async () => {
    f.state.context = {
      environment: "http://localhost:3000",
      userId: "B",
      generation: 2,
    };
    return false;
  };

  await f.integration.disconnectEpic(connection.connectionId);
  assert.deepEqual(
    f.state.events.filter((event) => event !== "on-epic-connection-changed"),
    ["cleanup", "merge"]
  );
});

test("shutdown waits for managed processes and saves before clearing credentials and the Epic queue", async (t) => {
  const f = fixture(t);
  await f.integration.initializeEpicIntegration();
  const releaseProcess = deferred<void>();
  const releaseSaves = deferred<void>();
  f.state.managedStopGate = releaseProcess.promise;
  f.state.saveStopGate = releaseSaves.promise;
  f.state.downloads = [
    {
      shop: "epic",
      objectId: "ns:active",
      downloader: Downloader.Epic,
      status: "active",
      queued: false,
    },
    {
      shop: "epic",
      objectId: "ns:queued",
      downloader: Downloader.Epic,
      status: "paused",
      queued: true,
    },
    {
      shop: "steam",
      objectId: "123",
      downloader: Downloader.Torrent,
      status: "paused",
      queued: true,
    },
  ] as Download[];
  f.state.activeDownloadId = "epic:ns:active";
  f.state.managedEvents = [];
  const stopped = f.integration.shutdownEpicIntegration();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.activeDownloadId, "epic:ns:active");
  assert.equal(f.state.managedEvents.includes("credentials-cleared"), false);
  releaseProcess.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.managedEvents.includes("credentials-cleared"), false);
  releaseSaves.resolve();
  await stopped;
  assert.equal(f.state.activeDownloadId, null);
  assert.deepEqual(
    f.state.downloads.map(({ status, queued }) => ({ status, queued })),
    [
      { status: "paused", queued: false },
      { status: "paused", queued: false },
      { status: "paused", queued: true },
    ]
  );
  assert.ok(
    f.state.managedEvents.indexOf("slot-released") >
      f.state.managedEvents.indexOf("process-stopped")
  );
  assert.ok(
    f.state.managedEvents.indexOf("credentials-cleared") >
      f.state.managedEvents.indexOf("saves-stopped")
  );
});

test("normal shutdown drains observed playtime before invalidating the runtime", async (t) => {
  const f = fixture(t);
  await f.integration.initializeEpicIntegration();
  const release = deferred<void>();
  f.state.reportDrainGate = release.promise;
  f.state.managedEvents = [];
  const shutdown = f.integration.shutdownEpicIntegration();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.state.managedEvents, ["reports-draining"]);
  release.resolve();
  await shutdown;
  assert.ok(
    f.state.managedEvents.indexOf("reports-drained") <
      f.state.managedEvents.indexOf("reports-aborted")
  );
  assert.ok(
    f.state.managedEvents.indexOf("reports-drained") <
      f.state.managedEvents.indexOf("process-stopping")
  );
});

test("an aborted shutdown restores auth and permits managed operations after cleanup recovers", async (t) => {
  const f = fixture(t);
  await f.integration.initializeEpicIntegration();
  const failedCleanup = Promise.reject(
    new EpicIntegrationError("cleanup-failed")
  );
  void failedCleanup.catch(() => undefined);
  f.state.managedStopGate = failedCleanup;
  await assert.rejects(f.integration.shutdownEpicIntegration(), {
    code: "cleanup-failed",
  });
  assert.equal(f.state.subscriptions, 2);
  assert.equal(f.state.unsubscriptions, 1);
  assert.ok(f.state.managedEvents.includes("reports-restored"));
  f.state.managedStopGate = Promise.resolve();
  assert.deepEqual(
    await f.integration.getEpicGameInstallOptions("Namespace:Item"),
    { options: [] }
  );
  await f.integration.shutdownEpicIntegration();
});

test("a confirmed write refreshes the captured game's remote total and ignores a later auth context", async (t) => {
  const f = fixture(t);
  f.state.context = {
    environment: "https://api.test",
    userId: "A",
    generation: 1,
  };
  f.state.connection = connection;
  await f.integration.initializeEpicIntegration();
  const target = {
    auth: { ...f.state.context },
    connection: { ...connection },
    artifactId: "Artifact",
  };
  f.state.managedEvents = [];
  await f.state.reportConfirmed!("Namespace:Item", target);
  assert.deepEqual(f.state.managedEvents, [
    "playtime-cache-cleared",
    "fresh-playtime:Namespace:Item",
  ]);
  f.state.context = {
    environment: "https://api.test",
    userId: "B",
    generation: 2,
  };
  await f.state.reportConfirmed!("Namespace:Item", target);
  assert.equal(f.state.managedEvents.length, 2);
});
