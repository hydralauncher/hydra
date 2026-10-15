import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import ts from "typescript";
import type { Download, Game } from "../../../types/level.types";
import type { DownloadProgress } from "../../../types/download.types";
import { Downloader } from "../../../shared/constants.js";
import * as downloadContract from "../../../types/download-contract.js";
import * as downloaderTypes from "./types.js";
import * as completion from "./download-completion.js";
import * as queueVerify from "./download-queue-verify.js";
import { withDownloadActivation } from "./download-activation.ts";
import { deferred } from "../epic/store-test-helpers.js";

const key = (download: Pick<Download, "shop" | "objectId">) =>
  `${download.shop}:${download.objectId}`;
const epic = (objectId: string): Download => ({
  shop: "epic",
  objectId,
  downloader: Downloader.Epic,
  uri: "",
  downloadPath: path.resolve("epic-manager-fixture"),
  folderName: "Game",
  fileSize: 1000,
  bytesDownloaded: 50,
  progress: 0.15,
  extracting: false,
  queued: false,
  status: "paused",
  timestamp: 1,
  automaticallyExtract: false,
  automaticallyDeleteArchiveFiles: false,
  shouldSeed: false,
  epic: {
    owner: { environment: "test", userId: "user", epicAccountId: "account" },
    connectionId: "connection",
    artifactId: objectId.replaceAll(":", "-"),
    platform: "Windows",
    diskSizeInBytes: 2000,
  },
});
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Exercise the production manager/orchestrator; replace only external I/O ports. */
function fixture() {
  const downloads = new Map<string, Download>();
  const games = new Map<string, Game>();
  const requests: Array<{
    download: Download;
    failure: (error: unknown) => void;
    current: () => boolean;
  }> = [];
  const state = {
    startGate: Promise.resolve(),
    stopGate: Promise.resolve(),
    notificationGate: Promise.resolve(),
    stopping: [] as string[],
    stopped: [] as string[],
    notifications: [] as string[],
    progress: [] as unknown[],
    layout: structuredClone(downloadContract.DEFAULT_DOWNLOAD_LAYOUT_STATE),
    completed: new Set<string>(),
    torrentCalls: [] as string[],
    httpStarted: [] as string[],
    httpPaused: 0,
    writes: [] as Download[],
    beforeRead: async (_id: string) => {
      return undefined;
    },
  };
  const sublevel = {
    get: async (id: string) => {
      await state.beforeRead(id);
      const value = downloads.get(id);
      return value ? structuredClone(value) : undefined;
    },
    put: async (id: string, value: Download) => {
      downloads.set(id, structuredClone(value));
      state.writes.push(structuredClone(value));
    },
    values: () => ({
      all: async () =>
        [...downloads.values()].map((value) => structuredClone(value)),
    }),
  };
  const windowManager = {
    mainWindow: null,
    sendDownloadsUpdated: () => {},
    sendToAppWindows: (event: string, payload: unknown) => {
      if (event === "on-download-progress") state.progress.push(payload);
    },
  };
  const service = {
    startRuntime: async (
      download: Download,
      failure: (error: unknown) => void,
      current: () => boolean
    ) => {
      requests.push({ download, failure, current });
      await state.startGate;
    },
    stop: async (id: string) => {
      state.stopping.push(id);
      await state.stopGate;
      state.stopped.push(id);
    },
    progress: (download: Download): DownloadProgress => ({
      gameId: key(download),
      download: {
        ...download,
        progress: 1,
        status: state.completed.has(key(download)) ? "complete" : "active",
      },
      progress: 1,
      downloadSpeed: 0,
      timeRemaining: 0,
      numPeers: 0,
      numSeeds: 0,
      isDownloadingMetadata: false,
      isCheckingFiles: false,
    }),
  };
  const modules: Record<string, unknown> = {
    "./download-activation": { withDownloadActivation },
    "./download/download-activation": { withDownloadActivation },
    "./range-download-state": { configureRangeStateDirectory: () => {} },
    "../system-path": { SystemPath: { getPath: () => os.tmpdir() } },
    "./download/debrid-files": { isDebridPendingError: () => false },
    "@shared": { Downloader },
    "../../types": downloadContract,
    "./types": downloaderTypes,
    "./download-completion": completion,
    "./download-queue-verify": queueVerify,
    "node:path": path,
    "node:fs": fs,
    "node:os": os,
    "node:timers/promises": { setTimeout: sleep },
    "@main/level": {
      downloadsSublevel: sublevel,
      gamesSublevel: { get: async (id: string) => games.get(id) },
      db: { get: async () => null },
      levelKeys: {
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
      downloadLayoutStateSublevel: {
        get: async () => state.layout,
        put: async (_id: string, value: typeof state.layout) => {
          state.layout = structuredClone(value);
        },
      },
    },
    "../epic/download": { getEpicDownloadService: () => service },
    "../epic/legendary-managed-runtime": {
      epicManagedErrorCode: (error: { code?: string }) =>
        error.code ?? "process-failed",
    },
    "../window-manager": { WindowManager: windowManager },
    "./window-manager": { WindowManager: windowManager },
    "../logger": { logger: { log: () => {}, error: () => {}, warn: () => {} } },
    "./logger": { logger: { log: () => {}, error: () => {}, warn: () => {} } },
    "../notifications": {
      publishDownloadCompleteNotification: async (game: Game) => {
        state.notifications.push(game.objectId);
        await state.notificationGate;
      },
      publishDownloadHaltedNotification: async () => {},
    },
    "../torrent-service": {
      TorrentService: {
        call: async (method: string) => {
          state.torrentCalls.push(method);
          throw new Error("Unexpected torrent dispatch");
        },
      },
    },
    "./disk-space": {
      DISK_SPACE_CHECK_INTERVAL_MS: 10000,
      getDownloadDiskSpace: async () => ({
        hasEnoughSpace: true,
        freeBytes: 10000,
        requiredBytes: 2000,
      }),
    },
  };
  for (const module of [
    "@main/services/game-record-updater",
    "../hosters",
    "./helpers",
    "./download-filename",
    "./real-debrid",
    "./torbox",
    "../game-files-manager",
    "./premiumize",
    "./all-debrid",
    "./js-http-downloader",
    "./torbox-batch-downloader",
    "./torbox-files",
    "./debrid-files",
    "./parallel-range-download",
    "./js-http-downloader-helpers",
    "@main/events/helpers/get-directory-size",
    "@main/helpers/download-error-handler",
  ])
    modules[module] = {};
  modules["./js-http-downloader"] = {
    JsHttpDownloader: class {
      setMaxDownloadSpeedBytesPerSecond() {
        return undefined;
      }
      startDownload(options: { url: string }) {
        state.httpStarted.push(options.url);
        return new Promise<void>(() => {});
      }
      pauseDownload() {
        state.httpPaused++;
      }
      cancelDownload() {
        state.httpPaused++;
      }
    },
  };
  function load<T>(file: string): T {
    const exports = {};
    vm.runInNewContext(
      ts.transpileModule(
        fs.readFileSync(new URL(file, import.meta.url), "utf8"),
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            esModuleInterop: true,
          },
        }
      ).outputText,
      {
        exports,
        AbortController,
        AbortSignal,
        require: (name: string) =>
          modules[name] ?? assert.fail(`Unexpected dependency ${name}`),
        Date,
        Math,
        process,
        URL,
        structuredClone,
        setTimeout,
        clearTimeout,
        performance,
      }
    );
    return exports as T;
  }
  const layout = load<typeof import("../download-layout-state")>(
    "../download-layout-state.ts"
  );
  modules["../download-layout-state"] = layout;
  modules["./download-layout-state"] = layout;
  const manager = load<typeof import("./download-manager")>(
    "./download-manager.ts"
  ).DownloadManager;
  modules["./download/download-manager"] = { DownloadManager: manager };
  const orchestrator = load<typeof import("../download-orchestrator")>(
    "../download-orchestrator.ts"
  ).DownloadOrchestrator;
  const add = (download: Download) => {
    downloads.set(key(download), download);
    games.set(key(download), {
      shop: download.shop,
      objectId: download.objectId,
      title: download.objectId,
    } as Game);
  };
  const prepareHttp = (download: Download) => {
    // A normal start reaches this cache after URL validation. Seed that input
    // here so the regression exercises scheduling without hoster/network I/O.
    const prepared = manager as unknown as {
      preparedJsDownloads: Map<string, unknown>;
    };
    prepared.preparedJsDownloads.set(key(download), {
      uri: download.uri,
      resolvedAt: Date.now(),
      options: {
        url: "https://fixture.invalid/archive.zip",
        savePath: download.downloadPath,
        filename: "archive.zip",
      },
    });
  };
  return {
    downloads,
    state,
    requests,
    manager,
    orchestrator,
    add,
    prepareHttp,
  };
}

test("Epic acceptance returns before preparation and concurrent clicks keep one active slot", async () => {
  const f = fixture();
  const first = epic("Namespace:FastOne"),
    second = epic("Namespace:FastTwo");
  f.add(first);
  f.add(second);
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  try {
    await Promise.all([
      f.orchestrator.acceptPreparedEpicDownload(first),
      f.orchestrator.acceptPreparedEpicDownload(second),
    ]);
    await settle();
    assert.equal(f.requests.length, 1);
    assert.equal(f.manager.getActiveDownloadId(), key(first));
    assert.equal(f.downloads.get(key(second))?.queued, true);
  } finally {
    preparation.resolve();
    await settle();
  }
});

test("cancel immediately after Epic acknowledgement stops its reserved slot without resurrecting it", async () => {
  const f = fixture();
  const download = epic("Namespace:ImmediateCancel");
  f.add(download);
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  await f.orchestrator.acceptPreparedEpicDownload(download);
  assert.equal(f.manager.getActiveDownloadId(), key(download));
  await f.orchestrator.cancelDownloadById(download.shop, download.objectId);
  preparation.resolve();
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), null);
  assert.equal(f.downloads.get(key(download))?.status, "removed");
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].current(), false);
});

test("cancel during the acceptance lookup cannot recreate its removed download", async () => {
  const f = fixture();
  const download = epic("Namespace:CanceledBeforeAck");
  f.add(download);
  const entered = deferred<void>();
  const release = deferred<void>();
  let blocked = false;
  f.state.beforeRead = async (id) => {
    if (id === key(download) && !blocked) {
      blocked = true;
      entered.resolve();
      await release.promise;
    }
  };
  const acceptance = f.orchestrator.acceptPreparedEpicDownload(download);
  await entered.promise;
  await f.orchestrator.cancelDownloadById(download.shop, download.objectId);
  release.resolve();
  await acceptance;
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), null);
  assert.equal(f.downloads.get(key(download))?.status, "removed");
  assert.equal(f.requests.length, 0);
});

test("explicit Epic start reserves the selected game without waiting for older queued non-Epic preparation", async () => {
  const f = fixture();
  const older: Download = {
    ...epic("OlderHttp"),
    shop: "steam",
    downloader: Downloader.PixelDrain,
    epic: undefined,
    queued: true,
  };
  const download = epic("Namespace:Selected");
  f.add(older);
  f.add(download);
  f.state.layout.queueOrder = [key(older)];
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  try {
    await f.orchestrator.acceptPreparedEpicDownload(download);
    assert.equal(f.manager.getActiveDownloadId(), key(download));
    assert.equal(f.requests.length, 1);
    assert.equal(f.state.httpStarted.length, 0);
    assert.equal(f.downloads.get(key(older))?.queued, true);
    assert.equal(f.downloads.get(key(older))?.status, "paused");
  } finally {
    preparation.resolve();
    await settle();
  }
});

for (const action of ["cancel-and-start", "pause-and-resume"] as const) {
  test(`late accepted Epic failure cannot overwrite ${action} with the same timestamp`, async (t) => {
    t.mock.method(Date, "now", () => 100);
    const f = fixture();
    const download = epic("Namespace:SameId");
    f.add(download);
    let fail!: (error: Error) => void;
    f.state.startGate = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    await f.orchestrator.acceptPreparedEpicDownload(download);
    if (action === "cancel-and-start")
      await f.orchestrator.cancelDownloadById(download.shop, download.objectId);
    else
      await f.orchestrator.pauseDownloadById(download.shop, download.objectId);
    f.state.startGate = Promise.resolve();
    if (action === "cancel-and-start")
      await f.orchestrator.acceptPreparedEpicDownload(download);
    else await f.orchestrator.resumeDownload(download.shop, download.objectId);
    fail(new Error("obsolete preparation failed"));
    await settle();
    assert.equal(f.manager.getActiveDownloadId(), key(download));
    assert.equal(f.downloads.get(key(download))?.status, "active");
    assert.equal(f.downloads.get(key(download))?.timestamp, 100);
    assert.equal(f.requests.length, 2);
    assert.equal(f.requests[0].current(), false);
    assert.equal(f.requests[1].current(), true);
  });
}

for (const [code, nextDownloader] of [
  ["insufficient-space", "epic"],
  ["stale-connection", "http"],
] as const) {
  test(`accepted Epic preparation failure preserves ${code} and starts the next ${nextDownloader} download`, async () => {
    const f = fixture();
    const download = epic("Namespace:Failed");
    const next: Download =
      nextDownloader === "epic"
        ? epic("Namespace:Next")
        : {
            ...epic("NextHttp"),
            shop: "steam",
            downloader: Downloader.PixelDrain,
            epic: undefined,
          };
    f.add(download);
    f.add(next);
    if (nextDownloader === "http") f.prepareHttp(next);
    let fail!: (error: Error) => void;
    f.state.startGate = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    await f.orchestrator.acceptPreparedEpicDownload(download);
    await f.orchestrator.startPreparedDownload(next);
    assert.equal(f.downloads.get(key(next))?.queued, true);
    f.state.startGate = Promise.resolve();
    fail(Object.assign(new Error("current preparation failed"), { code }));
    await settle();
    assert.equal(f.downloads.get(key(download))?.status, "error");
    assert.equal(f.downloads.get(key(download))?.epic?.error, code);
    assert.equal(f.manager.getActiveDownloadId(), key(next));
    assert.equal(f.downloads.get(key(next))?.status, "active");
    assert.equal(f.downloads.get(key(next))?.queued, false);
    const layout = await f.orchestrator.getLayoutState();
    assert.equal(layout.queueOrder.length, 0);
    assert.ok(layout.pausedOrder.includes(key(download)));
    if (nextDownloader === "epic") assert.equal(f.requests.length, 2);
    else assert.equal(f.state.httpStarted.length, 1);
  });
}

test("resuming a non-Epic download after Epic acknowledgement stops the reserved Epic preparation first", async () => {
  const f = fixture();
  const download = epic("Namespace:Interrupt");
  const http: Download = {
    ...epic("HttpGame"),
    shop: "steam",
    downloader: Downloader.PixelDrain,
    epic: undefined,
  };
  f.add(download);
  f.add(http);
  f.prepareHttp(http);
  const preparation = deferred<void>();
  f.state.startGate = preparation.promise;
  await f.orchestrator.acceptPreparedEpicDownload(download);
  await f.orchestrator.resumeDownload(http.shop, http.objectId);
  preparation.resolve();
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), key(http));
  assert.equal(f.downloads.get(key(download))?.status, "paused");
  assert.equal(f.downloads.get(key(http))?.status, "active");
  assert.equal(f.requests[0].current(), false);
  assert.equal(f.state.httpStarted.length, 1);
  assert.equal(
    [...f.downloads.values()].filter((entry) => entry.status === "active")
      .length,
    1
  );
});

test("an accepted Epic download queues behind a concurrently resumed non-Epic download", async () => {
  const f = fixture();
  const download = epic("Namespace:Concurrent");
  const http: Download = {
    ...epic("HttpGame"),
    shop: "steam",
    downloader: Downloader.PixelDrain,
    epic: undefined,
  };
  f.add(download);
  f.add(http);
  f.prepareHttp(http);
  await Promise.all([
    f.orchestrator.acceptPreparedEpicDownload(download),
    f.orchestrator.resumeDownload(http.shop, http.objectId),
  ]);
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), key(http));
  assert.equal(f.downloads.get(key(download))?.queued, true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.state.httpStarted.length, 1);
  assert.equal(
    [...f.downloads.values()].filter((entry) => entry.status === "active")
      .length,
    1
  );
});

test("production manager dispatches Epic preparation and retains the slot until pause stops it", async () => {
  const f = fixture();
  const download = epic("Namespace:One");
  f.add(download);
  const preparing = deferred<void>();
  f.state.startGate = preparing.promise;
  const start = f.orchestrator.startPreparedDownload(download);
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), key(download));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].download.downloader, Downloader.Epic);
  assert.equal(f.requests[0].current(), true);
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  const pause = f.orchestrator.pauseDownloadById(
    download.shop,
    download.objectId
  );
  await settle();
  assert.equal(f.requests[0].current(), false);
  assert.equal(f.manager.getActiveDownloadId(), key(download));
  preparing.resolve();
  await start;
  stopped.resolve();
  await pause;
  assert.equal(f.manager.getActiveDownloadId(), null);
  assert.equal(f.downloads.get(key(download))?.status, "paused");
  assert.equal(f.state.stopped[0], key(download));
  assert.equal(f.state.torrentCalls.length, 0);
});

test("Epic 100 percent telemetry does not complete or advance the queue before verification", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two");
  f.add(first);
  f.add(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  await f.manager.watchDownloads();
  assert.equal(f.manager.getActiveDownloadId(), key(first));
  assert.equal(f.downloads.get(key(first))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.queued, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.state.notifications.length, 0);
});

test("failed Epic startup persists a retryable paused record after confirmed cleanup", async () => {
  const f = fixture();
  const download = {
    ...epic("Namespace:Startup"),
    status: "active" as const,
    queued: true,
  };
  f.add(download);
  let rejectStart!: (reason: Error) => void;
  const cleanup = deferred<void>();
  f.state.startGate = new Promise<void>((_resolve, reject) => {
    rejectStart = reject;
  });
  f.state.stopGate = cleanup.promise;
  const started = f.manager.startDownload(download);
  const rejected = assert.rejects(started, /session-expired/);
  await settle();
  rejectStart(new Error("session-expired"));
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), key(download));
  assert.equal(f.downloads.get(key(download))?.status, "active");
  cleanup.resolve();
  await rejected;
  assert.equal(f.manager.getActiveDownloadId(), null);
  assert.equal(f.downloads.get(key(download))?.status, "paused");
  assert.equal(f.downloads.get(key(download))?.queued, false);
});

test("verified Epic completion publishes once and starts the next common queued download", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two");
  f.add(first);
  f.add(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  f.state.completed.add(key(first));
  const notification = deferred<void>();
  f.state.notificationGate = notification.promise;
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  const completion = f.manager.watchDownloads();
  await settle();
  await f.manager.watchDownloads();
  assert.equal(f.state.stopping.length, 1);
  assert.equal(f.state.notifications.length, 0);
  stopped.resolve();
  await settle();
  assert.equal(f.state.notifications.length, 1);
  assert.equal(f.manager.getActiveDownloadId(), null);
  notification.resolve();
  await completion;
  assert.equal(f.downloads.get(key(first))?.status, "complete");
  assert.equal(f.manager.getActiveDownloadId(), key(second));
  assert.equal(f.requests.length, 2);
  assert.equal(f.downloads.get(key(second))?.status, "active");
  assert.equal(f.downloads.get(key(second))?.queued, false);
  assert.ok(f.state.torrentCalls.every((method) => method === "status"));
});

test("Epic completion cannot replace a new active slot while its notification is pending", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two"),
    third = epic("Namespace:Three");
  f.add(first);
  f.add(second);
  f.add(third);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  f.state.completed.add(key(first));
  const notification = deferred<void>();
  f.state.notificationGate = notification.promise;
  const completion = f.manager.watchDownloads();
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), null);
  // Explicit resume claims the slot; prepared downloads preserve queue order.
  await f.orchestrator.resumeDownload(third.shop, third.objectId);
  notification.resolve();
  await completion;
  assert.equal(f.manager.getActiveDownloadId(), key(third));
  assert.equal(f.downloads.get(key(second))?.queued, true);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].download.objectId, third.objectId);
});

test("stale Epic error callbacks cannot stop a restarted download with the same identity", async () => {
  const f = fixture();
  const download = epic("Namespace:One");
  f.add(download);
  await f.orchestrator.startPreparedDownload(download);
  const old = f.requests[0];
  await f.orchestrator.pauseDownloadById(download.shop, download.objectId);
  await f.orchestrator.resumeDownload(download.shop, download.objectId);
  const stoppedBefore = f.state.stopped.length;
  old.failure({ code: "process-failed" });
  await settle();
  assert.equal(old.current(), false);
  assert.equal(f.requests[1].current(), true);
  assert.equal(f.manager.getActiveDownloadId(), key(download));
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.state.stopped.length, stoppedBefore);
});

test("Epic runtime failure waits for shutdown then marks error and advances the queue", async () => {
  const f = fixture();
  const first = epic("Namespace:One"),
    second = epic("Namespace:Two");
  f.add(first);
  f.add(second);
  await f.orchestrator.startPreparedDownload(first);
  await f.orchestrator.startPreparedDownload(second);
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  f.requests[0].failure({ code: "insufficient-space" });
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), key(first));
  assert.equal(f.requests.length, 1);
  stopped.resolve();
  await settle();
  assert.equal(f.downloads.get(key(first))?.status, "error");
  assert.equal(f.downloads.get(key(first))?.epic?.error, "insufficient-space");
  assert.equal(f.manager.getActiveDownloadId(), key(second));
  assert.equal(f.requests.length, 2);
});

test("a busy Linux prefix waits for cleanup and resumes finalization at full progress", async () => {
  const f = fixture();
  const download = {
    ...epic("Namespace:BusyPrefix"),
    progress: 1,
    bytesDownloaded: 1000,
    epic: {
      ...epic("Namespace:BusyPrefix").epic!,
      phase: "prerequisites" as const,
    },
  };
  f.add(download);
  await f.orchestrator.startPreparedDownload(download);
  const stopped = deferred<void>();
  f.state.stopGate = stopped.promise;
  f.requests[0].failure({ code: "compatibility-prefix-busy" });
  await settle();
  assert.equal(f.manager.getActiveDownloadId(), key(download));
  assert.equal(f.downloads.get(key(download))?.status, "active");
  assert.equal(f.state.notifications.length, 0);
  stopped.resolve();
  await settle();

  const failed = f.downloads.get(key(download))!;
  assert.equal(f.manager.getActiveDownloadId(), null);
  assert.equal(failed.status, "error");
  assert.equal(failed.epic?.error, "compatibility-prefix-busy");
  assert.equal(failed.progress, download.progress);
  assert.equal(failed.bytesDownloaded, download.bytesDownloaded);
  assert.equal(failed.folderName, download.folderName);
  assert.equal(failed.epic?.artifactId, download.epic.artifactId);
  assert.equal(f.state.notifications.length, 0);

  assert.equal(
    await f.orchestrator.resumeDownload(download.shop, download.objectId),
    true
  );
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].current(), false);
  assert.equal(f.requests[1].current(), true);
  assert.equal(f.requests[1].download.progress, download.progress);
  assert.equal(
    f.requests[1].download.bytesDownloaded,
    download.bytesDownloaded
  );
  f.state.completed.add(key(download));
  await f.manager.watchDownloads();
  assert.equal(f.downloads.get(key(download))?.status, "complete");
  assert.equal(f.state.notifications.length, 1);
  assert.equal(f.manager.getActiveDownloadId(), null);
});
