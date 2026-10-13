import { withDownloadActivation } from "./download-activation.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as torboxFiles from "./torbox-files.ts";
import * as rangeState from "./range-download-state.ts";
import { after, it } from "node:test";
import { loadTestModule } from "../../../../scripts/test/load-module.mjs";
import { runDownloadQueue } from "./download-work-queue.ts";
import { DownloadThrottle } from "./download-throttle.ts";
import * as shared from "../../../shared/constants.ts";
import * as batchHelpers from "./js-http-downloader-helpers.ts";
import * as debridFiles from "./debrid-files.ts";
import * as ranges from "./parallel-range-download.ts";
import * as filenames from "./download-filename.ts";
import type { RealDebridClient } from "./real-debrid.ts";
import type { DownloadProgress } from "../../../types/download.types.ts";
import type { DownloadFile } from "../../../types/level.types.ts";
import type { JsHttpDownloaderOptions } from "./js-http-downloader.ts";

const metadataDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "hydra-range-metadata-")
);
rangeState.configureRangeStateDirectory(metadataDirectory);
after(() => fs.rmSync(metadataDirectory, { recursive: true, force: true }));

function manager(
  manifest?: torboxFiles.TorBoxDownloadManifest,
  getFiles: () => Promise<
    torboxFiles.TorBoxDownloadManifest | undefined
  > = async () => manifest,
  realDebridEntries: Awaited<
    ReturnType<typeof RealDebridClient.getDownloadEntriesWithTorrent>
  >["entries"] = []
) {
  const starts: JsHttpDownloaderOptions[] = [];
  let stored: Record<string, unknown> = { files: [] };
  let unlocks = 0;
  const unlockSizes: number[] = [];
  class StubDownloader {
    private finish: () => void = () => undefined;
    setMaxDownloadSpeedBytesPerSecond() {
      return undefined;
    }
    setReconnecting() {
      return undefined;
    }
    pauseDownload() {
      this.finish();
    }
    async startDownload(options: JsHttpDownloaderOptions) {
      starts.push(options);
      await new Promise<void>((resolve) => {
        this.finish = resolve;
      });
    }
    getDownloadStatus() {
      return { status: "paused", resumeCapability: "unsupported" };
    }
  }
  const { TorBoxBatchDownloader } = loadTestModule(
    new URL("./torbox-batch-downloader.ts", import.meta.url),
    (id: string) =>
      ({
        "./download-throttle": { DownloadThrottle },
        "./download-work-queue": { runDownloadQueue },
        "./range-download-state": rangeState,
        "node:path": path,
        "./js-http-downloader": { JsHttpDownloader: StubDownloader },
        "./js-http-downloader-helpers": batchHelpers,
        "./parallel-range-download": ranges,
      })[id]
  );
  const exports = loadTestModule(
    new URL("./download-manager.ts", import.meta.url),
    (id: string) => {
      const deps: Record<string, unknown> = {
        "@shared": shared,
        "./download-activation": { withDownloadActivation },
        "node:fs": fs,
        "node:path": path,
        "../system-path": { SystemPath: { getPath: () => metadataDirectory } },
        "../logger": {
          logger: {
            log: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        },
        "../window-manager": {
          WindowManager: {
            sendDownloadsUpdated() {
              return undefined;
            },
          },
        },
        "./disk-space": {
          getDownloadDiskSpace: async () => ({ hasEnoughSpace: true }),
        },
        "../download-layout-state": {
          getDownloadLayoutStateRecord: async () => ({}),
          getNextQueuedDownloadFromLayout: (records: any[]) =>
            records.find((d) => d.queued),
        },
        "./debrid-files": debridFiles,
        "./torbox-files": torboxFiles,
        "./range-download-state": rangeState,
        "./torbox": {
          TorBoxClient: {
            getDownloadFiles: getFiles,
            requestLink: async () => "https://fixture.invalid/archive.zip",
          },
        },
        "./js-http-downloader": { JsHttpDownloader: StubDownloader },
        "./torbox-batch-downloader": { TorBoxBatchDownloader },
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
          levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
          downloadsSublevel: {
            get: async () => stored,
            values: () => ({ all: async () => [stored] }),
            put: async (_key: string, value: Record<string, unknown>) => {
              stored = value;
            },
          },
        },
        "./real-debrid": {
          RealDebridClient: {
            getDownloadEntriesWithTorrent: async () => ({
              torrentId: "fixture-torrent",
              entries: realDebridEntries,
            }),
            unlockFileWithDetails: async (
              _url: string,
              _path: string,
              size: number
            ) => {
              unlocks++;
              unlockSizes.push(size);
              return { url: "https://fixture.invalid/new-link", chunks: 1 };
            },
          },
        },
      };
      return deps[id] ?? {};
    }
  );
  const instance = exports.DownloadManager as {
    processNextQueuedDownload: () => Promise<void>;
    resumeDownload: (download: any) => Promise<void>;
    startDownload: (download: any, signal?: AbortSignal) => Promise<void>;
    hasActiveDownload: () => boolean;
    hasRunningDownload: (id: string) => boolean;
    getActiveDownloadId: () => string | null;
    requiresPauseConfirmation: (key: string) => boolean;
    getBatchDownloadOptions: (
      b: ReturnType<typeof batch>,
      entry: ReturnType<typeof batch>["entries"][number],
      url: string
    ) => JsHttpDownloaderOptions;
    getDownloadStatusFromJs: () => Promise<DownloadProgress | null>;
    getTorBoxDownloadOptions: (download: {
      uri: string;
      downloadPath: string;
      fileIndices?: number[];
      files?: DownloadFile[];
    }) => Promise<JsHttpDownloaderOptions & { totalSize?: number }>;
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
    starts,
    unlocks: () => unlocks,
    unlockSizes,
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

it("preserves the generated ZIP flag from the TorBox manifest through HTTP options", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zip-manifest-"));
  const f = manager({
    torrentId: 1,
    name: "folder",
    totalSize: 8,
    archiveOnly: true,
    files: [{ id: 0, path: "folder/archive.zip", size: 8 }],
  });
  try {
    await f.instance.startDownload({
      shop: "steam",
      objectId: "fixture",
      downloader: shared.Downloader.TorBox,
      uri: "magnet:fixture",
      downloadPath: directory,
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.starts.length, 1);
    const options = f.starts[0];
    assert.equal(options.filename, "archive.zip");
    assert.equal(options.savePath, directory);
    assert.equal(options.allowParallelRanges, false);
    assert.equal(options.requireRangeResume, false);
    assert.equal(options.expectedSize, undefined);
    assert.equal(options.verifyResumePrefix, true);
    assert.equal(f.instance.requiresPauseConfirmation("steam:fixture"), true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it("completion can start the next queued transfer while the old torrent is seeding", async () => {
  const f = manager();
  f.setStored({
    shop: "steam",
    objectId: "queued",
    status: "paused",
    queued: true,
  });
  Object.assign(f.instance, { downloadingGameId: "steam:seeding" });
  const resumed: string[] = [];
  f.instance.resumeDownload = async (d) => {
    resumed.push(d.objectId);
  };
  await f.instance.processNextQueuedDownload();
  assert.deepEqual(resumed, ["queued"]);
});
it("completion does not replace another transfer that already claimed the slot", async () => {
  const f = manager();
  f.setStored({
    shop: "steam",
    objectId: "active",
    status: "active",
    queued: false,
  });
  const resumed: string[] = [];
  f.instance.resumeDownload = async (d) => {
    resumed.push(d.objectId);
  };
  await f.instance.processNextQueuedDownload();
  assert.deepEqual(resumed, []);
});

it("aborted TorBox preparation releases the slot before the same download is retried", async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "torbox-aborted-preparation-")
  );
  let entered!: () => void;
  let release!: () => void;
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const manifest: torboxFiles.TorBoxDownloadManifest = {
    name: "folder",
    torrentId: 1,
    totalSize: 10,
    files: [{ id: 1, path: "folder/file.bin", size: 10 }],
  };
  const f = manager(manifest, async () => {
    entered();
    await waiting;
    return manifest;
  });
  const download = {
    shop: "steam",
    objectId: "fixture",
    downloader: shared.Downloader.TorBox,
    uri: "magnet:fixture",
    downloadPath: root,
  };
  f.setStored(download);
  const controller = new AbortController();
  const start = f.instance.startDownload(download, controller.signal);
  try {
    await preparing;
    assert.equal(f.instance.getActiveDownloadId(), "steam:fixture");
    assert.equal(f.instance.hasRunningDownload("steam:fixture"), false);
    controller.abort();
    release();
    await start.catch((error) => {
      assert.equal(error.name, "AbortError");
    });
    assert.equal(f.instance.hasActiveDownload(), false);
    assert.equal(f.instance.getActiveDownloadId(), null);
    assert.deepEqual(f.starts, []);
    await f.instance.startDownload(download);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.starts.length, 1);
    assert.equal(f.instance.hasRunningDownload("steam:fixture"), true);
    assert.equal(f.instance.getActiveDownloadId(), "steam:fixture");
  } finally {
    release();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const size of [0, 7]) {
  it(`Real-Debrid archives with size ${size} refresh links and require genuine range resume`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-archive-"));
    const f = manager(undefined, undefined, [
      {
        index: 0,
        path: "folder.zip",
        sourcePath: "/folder.zip",
        size,
        url: "packed",
        isLocked: true,
        isArchive: true,
        resourceId: "realDebrid:abc:archive:1,2",
        chunks: 1,
      },
    ]);
    try {
      await f.instance.startDownload({
        shop: "steam",
        objectId: "fixture",
        downloader: shared.Downloader.RealDebrid,
        uri: "magnet:fixture",
        downloadPath: directory,
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.starts.length, 1);
      const options = f.starts[0];
      assert.equal(options.url, "https://fixture.invalid/new-link");
      assert.equal(options.filename, "folder.zip");
      assert.equal(options.resourceId, "realDebrid:abc:archive:1,2");
      assert.equal(options.allowParallelRanges, false);
      assert.equal(options.requireRangeResume, true);
      assert.equal(options.requireResourceIdentity, true);
      assert.equal(options.verifyResumePrefix, true);
      assert.equal(options.expectedSize, undefined);
      assert.equal(
        await options.refreshUrl!(),
        "https://fixture.invalid/new-link"
      );
      assert.deepEqual(f.unlockSizes, [0, 0]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const age of [0, 120_000, -1000]) {
  it(`cached archive startup reuses only a fresh prepared URL (age ${age})`, async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "rd-cached-start-")
    );
    const f = manager(undefined, undefined, [
      {
        index: 0,
        path: "folder.zip",
        sourcePath: "/folder.zip",
        size: 7,
        url: "packed",
        isLocked: true,
        isArchive: true,
        resourceId: "realDebrid:abc:archive:1,2",
        preparedLink: {
          url: "https://fixture.invalid/prepared.zip",
          resolvedAt: Date.now() - age,
        },
        chunks: 8,
      },
    ]);
    try {
      await f.instance.startDownload({
        shop: "steam",
        objectId: "fixture",
        downloader: shared.Downloader.RealDebrid,
        uri: "magnet:fixture",
        downloadPath: directory,
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(f.starts.length, 1);
      const options = f.starts[0];
      assert.equal(
        options.url,
        age === 0
          ? "https://fixture.invalid/prepared.zip"
          : "https://fixture.invalid/new-link"
      );
      assert.equal(f.unlocks(), age === 0 ? 0 : 1);
      assert.equal(options.requireResourceIdentity, true);
      assert.equal(options.requireRangeResume, true);
      assert.equal(options.verifyResumePrefix, true);
      assert.equal(
        await options.refreshUrl!(),
        "https://fixture.invalid/new-link"
      );
      assert.equal(f.unlocks(), age === 0 ? 1 : 2);
      assert.ok(f.unlockSizes.every((size) => size === 0));
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

it("TorBox validation and startup retain completed, sparse partial, and missing file progress", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "torbox-progress-"));
  const files = [
    { id: 1, path: "folder/complete.bin", size: 4 },
    { id: 2, path: "folder/partial.bin", size: 8 },
    { id: 3, path: "folder/missing.bin", size: 2 },
  ];
  fs.mkdirSync(path.join(root, "folder"));
  fs.writeFileSync(path.join(root, files[0].path), Buffer.alloc(4));
  const partial = path.join(root, files[1].path);
  fs.writeFileSync(partial, Buffer.alloc(8));
  const f = manager({ torrentId: 1, name: "folder", totalSize: 14, files });
  const download = {
    shop: "steam",
    objectId: "fixture",
    downloader: shared.Downloader.TorBox,
    uri: "magnet:fixture",
    downloadPath: root,
    files: undefined as DownloadFile[] | undefined,
  };
  const progress = () =>
    Array.from(download.files ?? [], (file) => [
      file.index,
      file.bytesDownloaded,
      file.completed,
    ]);
  try {
    await rangeState.saveRangeState(partial, {
      version: 1,
      total: 8,
      validator: "etag:fixture",
      resourceId: null,
      ranges: [[0, 3]],
    });
    const options = await f.instance.getTorBoxDownloadOptions(download);
    const expected = [
      [1, 4, true],
      [2, 3, false],
      [3, 0, false],
    ];
    assert.deepEqual(progress(), expected);
    assert.equal(options.totalSize, 14);
    assert.equal(options.filename, files[0].path);
    await rangeState.saveCompletedResourceIdentity(
      path.join(root, files[0].path),
      "torBox:magnet:fixture#1"
    );
    f.setStored(download);
    await f.instance.startDownload(download);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(progress(), expected);
    assert.equal(f.starts.length, 2);
    assert.equal(f.starts[0].filename, files[1].path);
    assert.equal(f.starts[0].expectedSize, 8);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

for (const provider of ["torBox", "realDebrid"] as const) {
  for (const resume of [false, true]) {
    it(`${provider} saves a lone ZIP without a new folder and preserves an existing partial (${resume})`, async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-single-zip-"));
      const oldPath = "folder/archive.zip";
      const manifest = {
        torrentId: 1,
        name: "folder",
        totalSize: 8,
        files: [{ id: 0, path: oldPath, size: 8 }],
      };
      const entries = [
        {
          index: 0,
          path: oldPath,
          sourcePath: "/folder/archive.zip",
          size: 8,
          url: "https://fixture.invalid/direct",
          isLocked: false,
        },
      ];
      const f = manager(manifest, async () => manifest, entries);
      const download = {
        shop: "steam",
        objectId: "fixture",
        uri: "magnet:fixture",
        downloader:
          provider === "torBox"
            ? shared.Downloader.TorBox
            : shared.Downloader.RealDebrid,
        downloadPath: root,
        files: [
          {
            index: 0,
            path: oldPath,
            size: 8,
            bytesDownloaded: resume ? 2 : 0,
            completed: false,
          },
        ],
      };
      try {
        if (resume) {
          fs.mkdirSync(path.join(root, "folder"));
          fs.writeFileSync(path.join(root, oldPath), "ab");
        }
        f.setStored(download);
        await f.instance.startDownload(download);
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(f.starts.length, 1);
        assert.equal(f.starts[0].filename, resume ? oldPath : "archive.zip");
        assert.equal(f.starts[0].savePath, root);
        assert.equal(fs.existsSync(path.join(root, "folder")), resume);
        if (resume)
          assert.equal(fs.readFileSync(path.join(root, oldPath), "utf8"), "ab");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
}
it("multiple TorBox files keep their folder while a selected lone ZIP is flattened", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-zip-selection-"));
  const manifest = {
    torrentId: 1,
    name: "folder",
    totalSize: 10,
    files: [
      { id: 0, path: "folder/archive.zip", size: 8 },
      { id: 1, path: "folder/data.bin", size: 2 },
    ],
  };
  const f = manager(manifest);
  try {
    const download = { uri: "magnet:fixture", downloadPath: root };
    assert.equal(
      (await f.instance.getTorBoxDownloadOptions(download)).filename,
      "folder/archive.zip"
    );
    assert.equal(
      (
        await f.instance.getTorBoxDownloadOptions({
          ...download,
          fileIndices: [0],
        })
      ).filename,
      "archive.zip"
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
