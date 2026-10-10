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

for (const shouldDelete of [false, true]) {
  it(`nested extraction respects archive deletion preference ${shouldDelete}`, async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "archive-retention-")
    );
    const outer = path.join(directory, "bundle.zip");
    const extracted = path.join(directory, "bundle");
    fs.writeFileSync(outer, "saved archive");
    let record: any = {
      downloadPath: directory,
      folderName: "bundle.zip",
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
              fs.mkdirSync(extracted);
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
    try {
      await instance.extractDownloadedFile();
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
    },
    "./window-manager": {
      WindowManager: {
        sendDownloadsUpdated() {
          return undefined;
        },
      },
    },
    "./download/debrid-files": { isDebridPendingError: () => false },
    "./download/download-manager": {
      DownloadManager: {
        hasActiveDownload: () => runtimeActive,
        clearQueueVerifyAttempt() {
          return undefined;
        },
        prepareRealDebridDownload: async () => {
          entered();
          await preparation;
          return true;
        },
        resumeDownload: async (d: any) => {
          assert.equal(runtimeActive, false);
          runtimeActive = true;
          resumed.push(d.objectId);
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
      getNextQueuedDownloadFromLayout: (downloads: any[]) =>
        downloads.find((d) => d.queued),
    },
  });
  const active = { shop: "steam", objectId: "active", status: "active" };
  records.set(active.objectId, active);
  runtimeActive = true;
  return {
    instance: DownloadOrchestrator,
    afterQueue: (callback: () => void) => {
      afterQueue = callback;
    },
    records,
    resumed,
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
