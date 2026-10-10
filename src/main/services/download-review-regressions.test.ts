import { withDownloadActivation } from "./download/download-activation.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as shared from "../../shared/constants.ts";
import { listArchiveFiles } from "./archive-entry.ts";

function load(source: string, deps: Record<string, unknown>) {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(
    fs.readFileSync(new URL(source, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  runInNewContext(code, {
    exports,
    console,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    require: (id: string) => deps[id] ?? {},
  });
  return exports;
}
const logger = {
  log() {
    return undefined;
  },
  info() {
    return undefined;
  },
  error() {
    return undefined;
  },
  warn() {
    return undefined;
  },
};

for (const archiveName of [
  "bundle.zip",
  "Parent/Disc/bundle.zip",
  "Parent/Other/bundle.zip",
])
  for (const shouldDelete of [false, true]) {
    it(`extraction preserves ${archiveName} and deletion preference ${shouldDelete}`, async () => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "archive-retention-")
      );
      const outer = path.join(directory, archiveName);
      const extractedName = path.join(
        path.dirname(archiveName),
        path.parse(archiveName).name
      );
      const extracted = path.join(directory, extractedName);
      fs.mkdirSync(path.dirname(outer), { recursive: true });
      fs.writeFileSync(outer, "saved archive");
      let record: any = {
        downloadPath: directory,
        folderName: archiveName,
        automaticallyDeleteArchiveFiles: shouldDelete,
      };
      const prompts: string[][] = [];
      const { GameFilesManager } = load("./game-files-manager.ts", {
        "node:fs": fs,
        "node:path": path,
        "@shared": shared,
        "./download/download-activation": { withDownloadActivation },
        "@main/level": {
          levelKeys: { game: () => "fixture", userPreferences: "prefs" },
          db: {
            get: async () => ({
              deleteArchiveFilesAfterExtractionByDefault: !shouldDelete,
            }),
          },
          downloadsSublevel: {
            get: async () => record,
            put: async (_key: string, value: any) => {
              record = value;
            },
          },
          gamesSublevel: { get: async () => ({}) },
        },
        "./logger": { logger },
        "./archive-entry": { listArchiveFiles },
        "./extraction-path": { getPathType: async () => "directory" },
        "@main/events/library/delete-archive": {
          deleteArchiveFile: async (file: string) => fs.rmSync(file),
        },
        "./window-manager": {
          WindowManager: {
            sendToAppWindows: (event: string, paths: string[]) => {
              if (event === "on-archive-deletion-prompt") prompts.push(paths);
            },
          },
        },
        "./7zip": {
          SevenZip: {
            extractFile: async (options: any) => {
              if (options.outputPath) {
                assert.equal(options.outputPath, extracted);
                fs.mkdirSync(extracted, { recursive: true });
                fs.writeFileSync(
                  path.join(extracted, "inner.zip"),
                  "inner archive"
                );
              }
              return { success: true };
            },
          },
        },
      });
      const instance = new GameFilesManager("steam", "fixture");
      instance.setExtractionComplete = async () => undefined;
      instance.setExtractionFailedState = async (error: unknown) => {
        throw error;
      };
      try {
        assert.equal(await instance.extractDownloadedFile(), true);
        assert.equal(record.folderName, extractedName);
        assert.equal(fs.existsSync(outer), !shouldDelete);
        assert.equal(fs.existsSync(path.join(extracted, "inner.zip")), true);
        assert.deepEqual(
          prompts.map((p) => [...p]),
          shouldDelete ? [] : [[outer]]
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }

function orchestrator() {
  const records = new Map<string, any>();
  const resumed: string[] = [];
  const paused: string[] = [];
  let preparedReady = true;
  let afterResume: (() => Promise<void>) | undefined;
  let runtimeActive = false;
  let afterQueue: (() => void) | undefined;
  let release!: () => void;
  let entered!: () => void;
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const preparation = new Promise<void>((resolve) => {
    release = resolve;
  });
  const layout = () => ({
    queueOrder: [...records.values()]
      .filter((d) => d.queued)
      .map((d) => d.objectId),
    pausedOrder: [],
  });
  const { DownloadOrchestrator } = load("./download-orchestrator.ts", {
    "@shared": shared,
    "./download/download-activation": { withDownloadActivation },
    "./logger": { logger },
    "@main/level": {
      levelKeys: { game: (_shop: string, id: string) => id },
      downloadsSublevel: {
        get: async (key: string) => records.get(key),
        put: async (key: string, value: any) => {
          records.set(key, value);
        },
        values: () => ({ all: async () => [...records.values()] }),
      },
    },
    "../../types": {
      getDownloadId: (d: any) => d.objectId,
      isActiveLikeDownload: (d: any) => d.status === "active",
      isCompletedLikeDownload: (d: any) =>
        ["complete", "seeding"].includes(d.status),
      getBigPictureDownloadView: (downloads: any[], state: any) => ({
        heroId: downloads.find((d) => d.status === "active")?.objectId,
        queueIds: state.queueOrder,
        pausedIds: state.pausedOrder,
      }),
    },
    "./window-manager": {
      WindowManager: {
        sendToAppWindows() {
          return undefined;
        },
        sendDownloadsUpdated() {
          return undefined;
        },
      },
    },
    "./download/debrid-files": { isDebridPendingError: () => false },
    "./download/download-manager": {
      DownloadManager: {
        confirmPauseDownload: () => true,
        hasActiveDownload: () => runtimeActive,
        getActiveDownloadId: () =>
          runtimeActive ? (resumed.at(-1) ?? "active") : null,
        validateDownloadUrl: async () => undefined,
        clearQueueVerifyAttempt() {
          return undefined;
        },
        prepareRealDebridDownload: async () => {
          entered();
          await preparation;
          return preparedReady;
        },
        resumeDownload: async (d: any) => {
          assert.equal(runtimeActive, false);
          runtimeActive = true;
          resumed.push(d.objectId);
          await afterResume?.();
        },
        pauseDownload: async (id: string) => {
          paused.push(id);
          runtimeActive = false;
          const record = records.get(id);
          records.set(id, { ...record, status: "paused" });
        },
      },
    },
    "./download-layout-state": {
      syncDownloadLayoutState: async () => layout(),
      getNormalizedDownloadLayoutState: async () => layout(),
      setDownloadLayoutQueues: async () => {
        afterQueue?.();
      },
      removeDownloadFromLayoutState: async () => undefined,
      getQueuedDownloadsOrderedByLayout: (downloads: any[]) =>
        downloads.filter((d) => d.queued),
      getNextQueuedDownloadFromLayout: (downloads: any[]) =>
        downloads.find((d) => d.queued),
    },
  });
  const active = { shop: "steam", objectId: "active", status: "active" };
  records.set(active.objectId, active);
  runtimeActive = true;
  return {
    instance: DownloadOrchestrator,
    setPreparedReady: (ready: boolean) => {
      preparedReady = ready;
    },
    afterQueue: (callback: () => void) => {
      afterQueue = callback;
    },
    records,
    resumed,
    paused,
    afterResume: (callback: () => Promise<void>) => {
      afterResume = callback;
    },
    preparing,
    release,
    finishActive: () => {
      runtimeActive = false;
      records.set("active", { ...active, status: "complete" });
    },
    download: {
      shop: "steam",
      objectId: "next",
      status: "paused",
      downloader: shared.Downloader.RealDebrid,
      uri: "magnet:fixture",
    },
  };
}
it("starts a prepared download if the previous one completes during preparation", async () => {
  const f = orchestrator();
  const run = f.instance.startPreparedDownload(f.download);
  await f.preparing;
  f.finishActive();
  f.release();
  await run;
  assert.deepEqual(f.resumed, ["next"]);
  assert.equal(f.records.get("next").queued, false);
});
it("keeps a prepared download queued while the runtime remains active", async () => {
  const f = orchestrator();
  const run = f.instance.startPreparedDownload(f.download);
  await f.preparing;
  f.release();
  await run;
  assert.deepEqual(f.resumed, []);
  assert.equal(f.records.get("next").queued, true);
});
it("does not queue or start a cancelled preparation", async () => {
  const f = orchestrator();
  let current = true;
  const run = f.instance.startPreparedDownload(f.download, () => current);
  await f.preparing;
  current = false;
  f.finishActive();
  f.release();
  await run;
  assert.deepEqual(f.resumed, []);
  assert.equal(f.records.has("next"), false);
});

it("starts the queue when completion occurs while persisting its order", async () => {
  const f = orchestrator();
  f.afterQueue(f.finishActive);
  const run = f.instance.startPreparedDownload(f.download);
  await f.preparing;
  f.release();
  await run;
  assert.deepEqual(f.resumed, ["next"]);
});
it("serializes two preparations that become ready after completion", async () => {
  const f = orchestrator();
  const first = f.instance.startPreparedDownload(f.download);
  const second = f.instance.startPreparedDownload({
    ...f.download,
    objectId: "second",
  });
  await f.preparing;
  f.finishActive();
  f.release();
  await Promise.all([first, second]);
  assert.equal(f.resumed.length, 1);
  const queued = [...f.records.values()].filter((d) => d.queued);
  assert.equal(queued.length, 1);
});
it("a rejected activation does not block the next activation", async () => {
  await assert.rejects(
    withDownloadActivation(async () => {
      throw new Error("fixture failure");
    }),
    /fixture failure/
  );
  assert.equal(await withDownloadActivation(async () => "next"), "next");
});
it("startup expires pending preparation and restores only the first interrupted transfer", async () => {
  const f = orchestrator();
  f.records.clear();
  const common = { shop: "steam", uri: "magnet:fixture" };
  f.records.set("awaiting", {
    ...common,
    objectId: "awaiting",
    status: "active",
    awaitingDebrid: true,
    debridAutoResume: true,
    debridPreparationDeadline: Date.now() - 1,
    queued: true,
    extracting: true,
  });
  f.records.set("first", {
    ...common,
    objectId: "first",
    status: "active",
    pinnedToHero: true,
  });
  f.records.set("second", { ...common, objectId: "second", status: "active" });
  f.records.set("finished", {
    ...common,
    objectId: "finished",
    status: "complete",
    awaitingDebrid: true,
    debridAutoResume: true,
    queued: true,
  });
  const restored = await f.instance.bootstrapDownloadsOnStartup();
  assert.equal(restored.objectId, "first");
  assert.equal(f.records.get("awaiting").queued, false);
  assert.equal(f.records.get("awaiting").debridAutoResume, false);
  assert.equal(f.records.get("awaiting").extracting, false);
  assert.equal(f.records.get("first").queued, true);
  assert.equal(f.records.get("first").pinnedToHero, false);
  assert.equal(f.records.get("second").queued, false);
  assert.equal(f.records.get("finished").awaitingDebrid, false);
  assert.equal(f.records.get("finished").queued, false);
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function addManualDownload(
  f: ReturnType<typeof orchestrator>,
  objectId = "manual"
) {
  f.records.set(objectId, {
    ...f.download,
    objectId,
    progress: 0.4,
    awaitingDebrid: false,
  });
}

for (const action of ["resume", "hero"] as const) {
  it(`serializes ${action} with background activation after reading an empty slot`, async () => {
    const f = orchestrator();
    f.finishActive();
    addManualDownload(f);
    const entered = deferred();
    const release = deferred();
    const original = f.instance.getAllDownloads.bind(f.instance);
    let reads = 0;
    f.instance.getAllDownloads = async () => {
      const snapshot = await original();
      if (reads++ === 0) {
        entered.resolve();
        await release.promise;
      }
      return snapshot;
    };
    const manual =
      action === "resume"
        ? f.instance.resumeDownload("steam", "manual")
        : f.instance.moveDownloadPlacement("steam", "manual", "hero");
    await entered.promise;
    const background = f.instance.startPreparedDownload(f.download);
    await f.preparing;
    f.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Release the deliberate snapshot barrier even if the assertion fails.
    const startsBeforeRelease = [...f.resumed];
    release.resolve();
    const outcomes = await Promise.allSettled([manual, background]);
    assert.deepEqual(startsBeforeRelease, []);
    assert.ok(outcomes.every((result) => result.status === "fulfilled"));
    assert.deepEqual(f.resumed, ["manual"]);
    assert.equal(f.records.get("manual").status, "active");
    assert.equal(f.records.get("next").queued, true);
  });
}

for (const strategy of ["interruptActive", "queueIfActive"] as const) {
  it(`manual ${strategy} observes a background transfer that claims the slot first`, async () => {
    const f = orchestrator();
    f.finishActive();
    addManualDownload(f);
    const started = deferred();
    const release = deferred();
    f.afterResume(async () => {
      started.resolve();
      await release.promise;
    });
    const background = f.instance.startPreparedDownload(f.download);
    await f.preparing;
    f.release();
    await started.promise;
    const manual = f.instance.resumeDownload("steam", "manual", strategy);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const pausesBeforeRelease = [...f.paused];
    release.resolve();
    await Promise.all([background, manual]);
    assert.deepEqual(pausesBeforeRelease, []);
    if (strategy === "interruptActive") {
      assert.deepEqual(f.paused, ["next"]);
      assert.deepEqual(f.resumed, ["next", "manual"]);
      assert.equal(f.records.get("next").status, "paused");
      assert.equal(f.records.get("manual").status, "active");
    } else {
      assert.deepEqual(f.paused, []);
      assert.deepEqual(f.resumed, ["next"]);
      assert.equal(f.records.get("next").status, "active");
      assert.equal(f.records.get("manual").queued, true);
    }
  });
}

it("cancelled manual resume cannot claim the slot after waiting for activation", async () => {
  const f = orchestrator();
  f.finishActive();
  addManualDownload(f);
  const started = deferred();
  const release = deferred();
  f.afterResume(async () => {
    started.resolve();
    await release.promise;
  });
  const background = f.instance.startPreparedDownload(f.download);
  await f.preparing;
  f.release();
  await started.promise;
  const manual = f.instance.resumeDownload("steam", "manual");
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.instance.invalidateBackgroundStart("manual");
  release.resolve();
  const [, resumed] = await Promise.all([background, manual]);
  assert.equal(resumed, false);
  assert.deepEqual(f.resumed, ["next"]);
  assert.deepEqual(f.paused, []);
});

for (const action of ["resume", "hero"] as const) {
  it(`a second ${action} request for the same transfer retains its running downloader`, async () => {
    const f = orchestrator();
    f.finishActive();
    addManualDownload(f);
    const started = deferred();
    const release = deferred();
    f.afterResume(async () => {
      started.resolve();
      await release.promise;
    });
    const first = f.instance.resumeDownload("steam", "manual");
    await started.promise;
    const second =
      action === "resume"
        ? f.instance.resumeDownload("steam", "manual")
        : f.instance.moveDownloadPlacement("steam", "manual", "hero");
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    const outcomes = await Promise.allSettled([first, second]);
    assert.ok(outcomes.every((result) => result.status === "fulfilled"));
    assert.deepEqual(f.resumed, ["manual"]);
    assert.deepEqual(f.paused, []);
    assert.equal(f.records.get("manual").status, "active");
  });
}

for (const pending of [false, true]) {
  it(`adding a ${pending ? "pending" : "ready"} transfer to the queue does not start it`, async () => {
    const f = orchestrator();
    f.finishActive();
    f.instance.validateDownloadOrMarkPending = async (download: any) => {
      download.awaitingDebrid = pending;
    };
    let handler!: (
      _event: unknown,
      payload: Record<string, unknown>
    ) => Promise<unknown>;
    load("../events/torrenting/add-game-to-queue.ts", {
      "../register-event": {
        registerEvent: (_event: string, callback: typeof handler) => {
          handler = callback;
        },
      },
      "@types": {},
      "@shared": { parseBytes: () => 100 },
      "@main/services": {
        DownloadOrchestrator: f.instance,
        DownloadManager: { cancelDownload: async () => undefined },
        HydraApi: { post: async () => undefined },
        logger,
      },
      "@main/services/library-sync": { createGame: async () => undefined },
      "@main/helpers": {
        getGlobalTrackers: async () => [],
        prepareGameEntry: async () => undefined,
        isKnownDownloadError: () => false,
        handleDownloadError: (error: unknown) => {
          throw error;
        },
      },
      "@main/level": {
        levelKeys: { game: (_shop: string, id: string) => id },
        downloadsSublevel: {
          put: async (id: string, download: any) => {
            f.records.set(id, download);
          },
        },
        gamesSublevel: { get: async () => ({}) },
      },
    });
    const result = await handler(null, {
      ...f.download,
      downloader: shared.Downloader.TorBox,
      downloadPath: "/fixture",
      fileSize: "100 B",
    });
    assert.equal((result as { ok: boolean }).ok, true);
    await f.instance.pollAwaitingDebridDownloads();
    assert.deepEqual(f.resumed, []);
    assert.equal(f.records.get("next").queued, true);
    assert.equal(f.records.get("next").awaitingDebrid, false);
  });
}

for (const ready of [false, true]) {
  it(`Real-Debrid queue-only preparation keeps ${ready ? "ready" : "pending"} work queued without starting`, async () => {
    const f = orchestrator();
    f.finishActive();
    f.setPreparedReady(ready);
    await f.instance.enqueuePreparedDownload(f.download);
    await f.preparing;
    f.release();
    await new Promise<void>((resolve) => setImmediate(resolve));
    if (!ready) {
      assert.equal(f.records.get("next").debridQueueOnly, true);
      assert.equal(f.records.get("next").awaitingDebrid, true);
      f.setPreparedReady(true);
      await f.instance.pollAwaitingDebridDownloads();
    }
    assert.deepEqual(f.resumed, []);
    assert.equal(f.records.get("next").queued, true);
    assert.equal(!!f.records.get("next").awaitingDebrid, false);
    assert.equal(f.records.get("next").debridQueueOnly, undefined);
  });
}

it("manual resume replaces queue-only preparation intent", async () => {
  const f = orchestrator();
  f.finishActive();
  await f.instance.saveAwaitingDebridDownload({
    ...f.download,
    debridQueueOnly: true,
  });
  f.release();
  assert.equal(await f.instance.resumeDownload("steam", "next"), true);
  assert.deepEqual(f.resumed, ["next"]);
  assert.equal(f.records.get("next").debridQueueOnly, undefined);
});

it("pausing queue-only preparation prevents a later readiness poll from starting or queuing it", async () => {
  const f = orchestrator();
  f.finishActive();
  await f.instance.saveAwaitingDebridDownload({
    ...f.download,
    debridQueueOnly: true,
  });
  assert.equal(await f.instance.pauseDownloadById("steam", "next"), true);
  f.release();
  await f.instance.pollAwaitingDebridDownloads();
  assert.deepEqual(f.resumed, []);
  assert.equal(f.records.get("next").queued, false);
  assert.equal(f.records.get("next").debridAutoResume, false);
  assert.equal(f.records.get("next").debridQueueOnly, undefined);
});
