import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";

import {
  DEFAULT_MAX_CONCURRENT_DOWNLOADS,
  Downloader,
  MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS,
} from "../../../shared/constants.js";
import * as downloadContract from "../../../types/download-contract.js";
import type { DownloadProgress } from "../../../types/download.types";
import type {
  Download,
  Game,
  UserPreferences,
} from "../../../types/level.types";
import * as completion from "./download-completion.js";
import { withDownloadActivation } from "./download-activation.js";
import * as queueVerify from "./download-queue-verify.js";
import * as downloaderTypes from "./types.js";

export const key = (download: Pick<Download, "shop" | "objectId">) =>
  `${download.shop}:${download.objectId}`;

export const epic = (objectId: string): Download => ({
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

export const torrent = (objectId: string, hash: string): Download => ({
  ...epic(objectId),
  shop: "steam",
  downloader: Downloader.Torrent,
  uri: `magnet:?xt=urn:btih:${hash}`,
  epic: undefined,
});

export const http = (objectId: string): Download => ({
  ...epic(objectId),
  shop: "steam",
  downloader: Downloader.PixelDrain,
  uri: `https://fixture.invalid/${objectId}.zip`,
  epic: undefined,
});

export const settle = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

/** Exercise the production manager/orchestrator; replace only external I/O ports. */
export function fixture() {
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
    torrentActions: [] as Array<Record<string, unknown>>,
    torrentStatuses: new Map<string, Record<string, unknown>>(),
    httpStarted: [] as string[],
    httpLimits: [] as Array<number | null>,
    httpPaused: 0,
    writes: [] as Download[],
    preferences: null as UserPreferences | null,
    beforeRead: (_id: string): void | Promise<void> => undefined,
  };
  const sublevel = {
    get: async (id: string) => {
      await state.beforeRead(id);
      const value = downloads.get(id);
      return value ? structuredClone(value) : undefined;
    },
    put: (id: string, value: Download) => {
      downloads.set(id, structuredClone(value));
      state.writes.push(structuredClone(value));
    },
    values: () => ({
      all: () => [...downloads.values()].map((value) => structuredClone(value)),
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
    "@shared": {
      DEFAULT_MAX_CONCURRENT_DOWNLOADS,
      Downloader,
      MAX_CONFIGURABLE_CONCURRENT_DOWNLOADS,
    },
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
      gamesSublevel: { get: (id: string) => games.get(id) },
      db: { get: () => state.preferences },
      levelKeys: {
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
      downloadLayoutStateSublevel: {
        get: () => Promise.resolve(structuredClone(state.layout)),
        put: (_id: string, value: typeof state.layout) => {
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
        call: (method: string, params?: Record<string, unknown>) => {
          state.torrentCalls.push(method);
          if (method === "action" && params) state.torrentActions.push(params);
          if (method === "status" && typeof params?.game_id === "string")
            return Promise.resolve({
              data: state.torrentStatuses.get(params.game_id) ?? null,
            });
          return Promise.resolve({ data: null });
        },
      },
    },
    "./disk-space": {
      DISK_SPACE_CHECK_INTERVAL_MS: 10000,
      getDownloadDiskSpace: () => ({
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
  modules["./helpers"] = { calculateETA: () => 0 };
  modules["../game-files-manager"] = {
    GameFilesManager: class {
      searchAndBindExecutable() {
        return undefined;
      }
      autoLinkClassicsDiscs() {
        return undefined;
      }
    },
  };
  modules["./js-http-downloader"] = {
    JsHttpDownloader: class {
      setMaxDownloadSpeedBytesPerSecond(limit: number | null) {
        state.httpLimits.push(limit);
      }
      startDownload(options: { url: string }) {
        state.httpStarted.push(options.url);
        return new Promise<void>(() => {});
      }
      pauseDownload() {
        state.httpPaused++;
      }
      waitForIdle() {
        return undefined;
      }
      getDownloadStatus() {
        return null;
      }
      cancelDownload() {
        state.httpPaused++;
      }
    },
  };

  const trustedSourceFiles = [
    "../download-layout-state.ts",
    "./download-manager.ts",
    "../download-orchestrator.ts",
  ] as const;
  type TrustedSourceFile = (typeof trustedSourceFiles)[number];
  const trustedSourceFileSet = new Set<string>(trustedSourceFiles);

  function loadTrustedModule<T>(file: TrustedSourceFile): T {
    assert.ok(
      trustedSourceFileSet.has(file),
      `Unexpected source file: ${file}`
    );

    const sourceUrl = new URL(file, import.meta.url);
    const realSourcePath = fs.realpathSync(sourceUrl);
    const trustedRoot = fs.realpathSync(new URL("../", import.meta.url));
    assert.ok(
      realSourcePath.startsWith(`${trustedRoot}${path.sep}`),
      `Source file is outside the trusted services directory: ${file}`
    );
    assert.ok(
      fs.statSync(realSourcePath).isFile(),
      `Source is not a file: ${file}`
    );

    const exports = Object.create(null) as Record<string, unknown>;
    // Test-only module loading: file is one of three fixed repository sources,
    // its real path is checked above, and require rejects unknown dependencies.
    // The VM provides fresh module state; it is not an untrusted-code sandbox.
    const script = new vm.Script( // NOSONAR
      ts.transpileModule(fs.readFileSync(realSourcePath, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
      }).outputText,
      { filename: realSourcePath }
    );
    script.runInNewContext(
      {
        exports,
        AbortController,
        AbortSignal,
        require: (name: string) =>
          Object.hasOwn(modules, name)
            ? modules[name]
            : assert.fail(`Unexpected dependency ${name}`),
        Date,
        URL,
        structuredClone,
        setTimeout,
        clearTimeout,
      },
      { timeout: 5_000 }
    );
    return exports as T;
  }
  const layout = loadTrustedModule<typeof import("../download-layout-state")>(
    "../download-layout-state.ts"
  );
  modules["../download-layout-state"] = layout;
  modules["./download-layout-state"] = layout;
  const manager = loadTrustedModule<typeof import("./download-manager")>(
    "./download-manager.ts"
  ).DownloadManager;
  modules["./download/download-manager"] = { DownloadManager: manager };
  const orchestrator = loadTrustedModule<
    typeof import("../download-orchestrator")
  >("../download-orchestrator.ts").DownloadOrchestrator;
  modules["../download-orchestrator"] = { DownloadOrchestrator: orchestrator };
  const add = (download: Download) => {
    downloads.set(key(download), download);
    games.set(key(download), {
      shop: download.shop,
      objectId: download.objectId,
      title: download.objectId,
    } as Game);
  };
  const prepareHttp = (download: Download) => {
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
