import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as shared from "../../../shared/constants.ts";
import * as batchHelpers from "./js-http-downloader-helpers.ts";
import * as debridFiles from "./debrid-files.ts";
import * as ranges from "./parallel-range-download.ts";
import * as filenames from "./download-filename.ts";
import type { DownloadProgress } from "../../../types/download.types.ts";
import type { JsHttpDownloaderOptions } from "./js-http-downloader.ts";

function manager() {
  const exports: Record<string, unknown> = {};
  let stored: Record<string, unknown> = { files: [] };
  let unlocks = 0;
  const code = ts.transpileModule(
    fs.readFileSync(new URL("./download-manager.ts", import.meta.url), "utf8"),
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
    AbortSignal,
    AbortController,
    Date,
    Map,
    Set,
    require: (id: string) => {
      const deps: Record<string, unknown> = {
        "@shared": shared,
        "node:fs": fs,
        "node:path": path,
        "../logger": {
          logger: {
            log: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        },
        "./debrid-files": debridFiles,
        "./parallel-range-download": ranges,
        "./js-http-downloader-helpers": batchHelpers,
        "./helpers": { calculateETA: () => 0 },
        "./download-filename": filenames,
        "./premiumize": {
          PremiumizeClient: {
            getDownloadUrl: async () => "https://fixture.invalid/original.bin",
          },
        },
        "./all-debrid": {
          AllDebridClient: {
            getDownloadInfo: async () => ({
              url: "https://fixture.invalid/original.bin",
              filename: "original.bin",
            }),
          },
        },
        "@main/level": {
          downloadsSublevel: {
            get: async () => stored,
            put: async (_key: string, value: Record<string, unknown>) => {
              stored = value;
            },
          },
        },
        "./real-debrid": {
          RealDebridClient: {
            unlockFileWithDetails: async () => {
              unlocks++;
              return { url: "https://fixture.invalid/new-link", chunks: 1 };
            },
          },
        },
      };
      return deps[id] ?? {};
    },
  });
  const instance = exports.DownloadManager as {
    getBatchDownloadOptions: (
      b: ReturnType<typeof batch>,
      entry: ReturnType<typeof batch>["entries"][number],
      url: string
    ) => JsHttpDownloaderOptions;
    getDownloadStatusFromJs: () => Promise<DownloadProgress | null>;
    getPremiumizeDownloadOptions: (download: {
      uri: string;
      downloadPath: string;
      fileIndices?: number[];
    }) => Promise<JsHttpDownloaderOptions & { totalSize?: number }>;
    getAllDebridDownloadOptions: (download: {
      uri: string;
      downloadPath: string;
      fileIndices?: number[];
    }) => Promise<JsHttpDownloaderOptions & { totalSize?: number }>;
  };
  return {
    instance,
    unlocks: () => unlocks,
    setStored: (d: Record<string, unknown>) => {
      stored = d;
    },
  };
}
function batch(provider = "realDebrid") {
  return {
    provider,
    sourceUri: "magnet:test",
    downloadId: "steam:test",
    savePath: "/tmp",
    entries: [
      {
        fileIndex: 1,
        filename: "Game/first.bin",
        sourcePath: "/first.bin",
        size: 3,
        isLocked: true,
        url: "locked-1",
        chunks: 1,
      },
      {
        fileIndex: 2,
        filename: "Game/second.bin",
        sourcePath: "/second.bin",
        size: 5,
        isLocked: true,
        url: "locked-2",
        chunks: 32,
      },
    ],
    currentIndex: 1,
    activeIndex: 1,
    completedBytes: 3,
    totalBytes: 8,
    lastSpeedUpdate: Date.now(),
    bytesAtLastSpeedUpdate: null,
    batchSpeed: 0,
  };
}
it("Real-Debrid requires genuine range resume and enforces the file's exact size", () => {
  const { instance } = manager();
  const b = batch();
  const o = instance.getBatchDownloadOptions(
    b,
    b.entries[0],
    "https://fixture.invalid/file"
  );
  assert.equal(o.requireRangeResume, true);
  assert.equal(o.expectedSize, 3);
  assert.equal(o.preserveFilename, true);
  assert.equal(o.resourceId, "realDebrid:magnet:test#1");
});
for (const [chunks, expected] of [
  [1, 1],
  [2, 2],
  [32, 8],
  [0, 4],
  [-1, 4],
  [NaN, 4],
])
  it(`respects Real-Debrid chunk count ${chunks}`, () => {
    const { instance } = manager();
    const b = batch();
    b.entries[0].chunks = chunks;
    assert.equal(
      instance.getBatchDownloadOptions(
        b,
        b.entries[0],
        "https://fixture.invalid/file"
      ).parallelRangeConnections,
      expected
    );
  });
it("refreshes an expired Real-Debrid URL through the file unlock API", async () => {
  const f = manager();
  const b = batch();
  b.entries[0].chunks = 32;
  const o = f.instance.getBatchDownloadOptions(
    b,
    b.entries[0],
    "https://fixture.invalid/file"
  ) as JsHttpDownloaderOptions;
  assert.equal(await o.refreshUrl!(), "https://fixture.invalid/new-link");
  assert.equal(f.unlocks(), 1);
  assert.equal(o.parallelRangeConnections, 1);
  assert.equal(b.entries[0].chunks, 1);
});
it("restored AllDebrid batches keep the original HTTP downloader defaults", () => {
  const { instance } = manager();
  const b = batch("allDebrid");
  const o = instance.getBatchDownloadOptions(
    b,
    b.entries[0],
    "https://fixture.invalid/file"
  );
  assert.equal(o.allowParallelRanges, undefined);
  assert.equal(o.requireRangeResume, false);
  assert.equal(o.expectedSize, undefined);
  assert.equal(o.refreshUrl, undefined);
});
it("restored Premiumize downloads use the original single-file URL", async () => {
  const { instance } = manager();
  const o = await instance.getPremiumizeDownloadOptions({
    uri: "magnet:test",
    downloadPath: "/tmp",
    fileIndices: [999],
  });
  assert.equal(o.url, "https://fixture.invalid/original.bin");
  assert.equal(o.filename, "original.bin");
  assert.equal(o.totalSize, undefined);
});
it("restored AllDebrid options use the original download-info method", async () => {
  const { instance } = manager();
  const o = await instance.getAllDebridDownloadOptions({
    uri: "magnet:test",
    downloadPath: "/tmp",
    fileIndices: [999],
  });
  assert.equal(o.url, "https://fixture.invalid/original.bin");
  assert.equal(o.filename, "original.bin");
  assert.equal(o.allowParallelRanges, undefined);
});
it("returns per-file Real-Debrid progress and keeps the completed first file", async () => {
  const f = manager();
  const b = batch();
  f.setStored({
    fileSize: 8,
    files: [
      {
        index: 1,
        path: "Game/first.bin",
        size: 3,
        bytesDownloaded: 3,
        completed: true,
      },
      {
        index: 2,
        path: "Game/second.bin",
        size: 5,
        bytesDownloaded: 0,
        completed: false,
      },
    ],
  });
  Object.assign(f.instance, {
    downloadingGameId: "steam:test",
    startGeneration: 1,
    isPreparingDownload: false,
    jsBatch: b,
    jsDownloader: {
      getDownloadStatus: () => ({
        status: "active",
        progress: 0.4,
        bytesDownloaded: 2,
        fileSize: 5,
        folderName: "Game",
        downloadSpeed: 1,
      }),
    },
  });
  const result = await f.instance.getDownloadStatusFromJs();
  assert.ok(result);
  assert.equal(result.download.bytesDownloaded, 5);
  assert.equal(result.progress, 5 / 8);
  assert.ok(result.download.files);
  assert.deepEqual(
    Array.from(result.download.files, (file) => [
      file.index,
      file.bytesDownloaded,
      file.completed,
    ]),
    [
      [1, 3, true],
      [2, 2, false],
    ]
  );
});
