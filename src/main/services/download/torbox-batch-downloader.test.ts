import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { after, it, type TestContext } from "node:test";
import { loadTestModule } from "../../../../scripts/load-test-module.mjs";
import { DownloadThrottle } from "./download-throttle.ts";
import * as helpers from "./js-http-downloader-helpers.ts";
import * as parallel from "./parallel-range-download.ts";
import * as rangeState from "./range-download-state.ts";
import type { TorBoxBatchDownloader as BatchType } from "./torbox-batch-downloader.ts";

const metadata = fs.mkdtempSync(
  path.join(os.tmpdir(), "hydra-batch-metadata-")
);
rangeState.configureRangeStateDirectory(metadata);
after(() => fs.rmSync(metadata, { recursive: true, force: true }));
const dependencies: Record<string, unknown> = {
  "./download-throttle": { DownloadThrottle },
  "./js-http-downloader-helpers": helpers,
  "./parallel-range-download": parallel,
  "./range-download-state": rangeState,
  "../logger": {
    logger: {
      log() {
        return undefined;
      },
      warn() {
        return undefined;
      },
      error() {
        return undefined;
      },
    },
  },
};
const require = createRequire(import.meta.url);
const dependency = (id: string) =>
  id.startsWith("node:") ? require(id) : dependencies[id];
dependencies["./js-http-downloader"] = loadTestModule(
  new URL("./js-http-downloader.ts", import.meta.url),
  dependency
);
const { TorBoxBatchDownloader } = loadTestModule(
  new URL("./torbox-batch-downloader.ts", import.meta.url),
  dependency
) as { TorBoxBatchDownloader: typeof BatchType };

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for transfer state");
    await delay(5);
  }
}

async function fixture(
  t: TestContext,
  sizes = Array<number>(12).fill(64 * 1024)
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-batch-"));
  const data = sizes.map((size, index) => Buffer.alloc(size, index + 1));
  const requests: { index: number; start: number; end: number }[] = [];
  const links: { index: number; requests: number }[] = [];
  const activeFiles = new Map<number, number>();
  let active = 0;
  let peak = 0;
  let overlapLarge = false;
  const settings = {
    linkDelay: 40,
    headerDelay: 20,
    expired: false,
    failIndex: -1,
    hangHeaders: false,
  };
  const server = http.createServer((req, res) => {
    const index = Number(
      new URL(req.url!, "http://fixture.invalid").pathname.slice(1)
    );
    const body = data[index];
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2]
      ? Math.min(Number(match[2]), body.length - 1)
      : body.length - 1;
    requests.push({ index, start, end });
    active++;
    activeFiles.set(index, (activeFiles.get(index) ?? 0) + 1);
    peak = Math.max(peak, active);
    if (
      activeFiles.size > 1 &&
      [...activeFiles.keys()].some(
        (id) => sizes[id] > parallel.PARALLEL_RANGE_SIZE
      )
    )
      overlapLarge = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const headerTimer = setTimeout(() => {
      if (settings.hangHeaders) return;
      if (req.url!.includes("expired")) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (start >= body.length) {
        res.writeHead(416, { "Content-Range": `bytes */${body.length}` });
        res.end();
        return;
      }
      res.writeHead(match ? 206 : 200, {
        "Content-Length": end - start + 1,
        "Content-Type": "application/octet-stream",
        "Accept-Ranges": "bytes",
        ETag: '"fixture-v1"',
        ...(match
          ? { "Content-Range": `bytes ${start}-${end}/${body.length}` }
          : {}),
      });
      let cursor = start;
      timer = setInterval(() => {
        const next = Math.min(
          cursor +
            (body.length > parallel.PARALLEL_RANGE_SIZE ? 256 * 1024 : 8192),
          end + 1
        );
        res.write(body.subarray(cursor, next));
        cursor = next;
        if (cursor > end) res.end();
      }, 3);
    }, settings.headerDelay);
    res.once("close", () => {
      clearTimeout(headerTimer);
      clearInterval(timer);
      active--;
      const count = activeFiles.get(index)! - 1;
      if (count) activeFiles.set(index, count);
      else activeFiles.delete(index);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const batches: BatchType[] = [];
  const make = () => {
    const files = sizes.map((size, index) => {
      const filename = `folder/sub/file-${index}.bin`;
      const filePath = path.join(root, filename);
      const bytes = rangeState.getRangeDownloadedBytes(filePath);
      return {
        index,
        path: filename,
        size,
        bytesDownloaded: bytes,
        completed: fs.existsSync(filePath) && bytes === size,
      };
    });
    const batch = new TorBoxBatchDownloader(
      files,
      "folder",
      async (index, signal) => {
        links.push({ index, requests: requests.length });
        await delay(settings.linkDelay, undefined, { signal });
        if (index === settings.failIndex)
          throw new Error("Fixture link failure");
        return `http://127.0.0.1:${port}/${index}${settings.expired && links.filter((link) => link.index === index).length === 1 ? "?expired" : ""}`;
      },
      (index, url) => ({
        url,
        savePath: root,
        filename: files[index].path,
        preserveFilename: true,
        expectedSize: files[index].size,
        requireRangeResume: true,
        resourceId: `fixture:${index}`,
      })
    );
    batches.push(batch);
    return batch;
  };
  const verify = () =>
    data.forEach((body, index) =>
      assert.deepEqual(
        fs.readFileSync(path.join(root, `folder/sub/file-${index}.bin`)),
        body
      )
    );
  t.after(async () => {
    for (const batch of batches) {
      batch.pauseDownload();
      await batch.waitForIdle();
    }
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root,
    make,
    verify,
    links,
    requests,
    settings,
    active: () => active,
    peak: () => peak,
    overlapLarge: () => overlapLarge,
  };
}

it("small files overlap within four connections and prepare each upcoming link once", async (t) => {
  const f = await fixture(t);
  const batch = f.make();
  await batch.startDownload();
  assert.equal(f.peak(), 4);
  assert.equal(f.links.length, 12);
  assert.equal(new Set(f.links.map((link) => link.index)).size, 12);
  assert.equal(f.links[4].requests, 0);
  assert.equal(batch.getDownloadStatus().status, "complete");
  assert.ok(batch.getFiles().every((file) => file.completed));
  f.verify();
});

it("large range downloads share the four-connection budget with small files", async (t) => {
  const f = await fixture(t, [
    64 * 1024,
    64 * 1024,
    24 * 1024 * 1024,
    64 * 1024,
    64 * 1024,
  ]);
  await f.make().startDownload();
  assert.ok(f.peak() <= 4);
  assert.equal(f.overlapLarge(), false);
  assert.ok(f.requests.filter((request) => request.index === 2).length >= 3);
  f.verify();
});

it("pause stops every worker and a new batch resumes partials while skipping out-of-order completions", async (t) => {
  const f = await fixture(t, [
    1024 * 1024,
    32 * 1024,
    1024 * 1024,
    1024 * 1024,
    1024 * 1024,
  ]);
  const batch = f.make();
  const run = batch.startDownload();
  await waitUntil(
    () =>
      batch.getFiles()[1].completed &&
      batch
        .getFiles()
        .filter((file) => !file.completed && file.bytesDownloaded > 16384)
        .length >= 3
  );
  batch.pauseDownload();
  await batch.waitForIdle();
  await run;
  const saved = batch.getFiles();
  assert.equal(batch.getDownloadStatus().status, "paused");
  assert.equal(batch.getDownloadStatus().downloadSpeed, 0);
  await waitUntil(() => f.active() === 0);
  const snapshots = saved.map((file) =>
    fs.existsSync(path.join(f.root, file.path))
      ? fs.readFileSync(path.join(f.root, file.path))
      : null
  );
  await delay(120);
  snapshots.forEach((snapshot, index) => {
    if (snapshot)
      assert.deepEqual(
        fs.readFileSync(path.join(f.root, saved[index].path)),
        snapshot
      );
  });
  const boundary = f.requests.length;
  await f.make().startDownload();
  const resumed = f.requests.slice(boundary);
  assert.ok(resumed.length > 0);
  assert.ok(resumed.every((request) => request.index !== 1));
  for (const file of saved.filter(
    (file) => !file.completed && file.bytesDownloaded > 0
  ))
    assert.ok(
      resumed
        .filter((request) => request.index === file.index)
        .every((request) => request.start > 0)
    );
  f.verify();
});

for (const stage of ["links", "headers", "body"] as const) {
  it(`cancel stops all transfers and pending link preparation during ${stage}`, async (t) => {
    const f = await fixture(t, Array<number>(8).fill(1024 * 1024));
    if (stage === "links") f.settings.linkDelay = 1000;
    if (stage === "headers") f.settings.hangHeaders = true;
    const batch = f.make();
    const run = batch.startDownload();
    if (stage === "links") await waitUntil(() => f.links.length >= 4);
    else if (stage === "headers")
      await waitUntil(() => f.requests.length === 4);
    else
      await waitUntil(
        () =>
          batch.getFiles().filter((file) => file.bytesDownloaded > 0).length ===
          4
      );
    batch.pauseDownload();
    await batch.waitForIdle();
    batch.cancelDownload();
    await run;
    await waitUntil(() => f.active() === 0);
    const count = f.requests.length;
    await delay(100);
    assert.equal(f.requests.length, count);
    assert.ok(
      batch
        .getFiles()
        .every((file) => !fs.existsSync(path.join(f.root, file.path)))
    );
    assert.ok(f.links.length <= 8);
  });
}

it("a failed worker stops its peers, preserves partials, and reports the original failure", async (t) => {
  const f = await fixture(t, Array<number>(8).fill(1024 * 1024));
  f.settings.failIndex = 4;
  f.settings.linkDelay = 120;
  const batch = f.make();
  await assert.rejects(batch.startDownload(), /Fixture link failure/);
  await batch.waitForIdle();
  assert.equal(batch.getDownloadStatus().status, "error");
  await waitUntil(() => f.active() === 0);
  assert.ok(
    batch.getFiles().some((file) => !file.completed && file.bytesDownloaded > 0)
  );
  batch.cancelDownload(false);
  assert.ok(
    fs.existsSync(path.join(f.root, "folder/sub/file-4.bin")) === false
  );
  f.settings.failIndex = -1;
  await f.make().startDownload();
  f.verify();
});

it("all small-file workers share one configured speed limit", async (t) => {
  const f = await fixture(t, Array<number>(4).fill(64 * 1024));
  const batch = f.make();
  f.settings.linkDelay = 500;
  batch.setMaxDownloadSpeedBytesPerSecond(128 * 1024);
  const started = Date.now();
  await batch.startDownload();
  assert.ok(
    Date.now() - started >= 2350,
    "Combined transfers exceeded their shared speed limit"
  );
  f.verify();
});

it("changing the speed limit releases every active worker", async (t) => {
  const f = await fixture(t, Array<number>(4).fill(64 * 1024));
  const batch = f.make();
  batch.setMaxDownloadSpeedBytesPerSecond(32 * 1024);
  const run = batch.startDownload();
  await waitUntil(() => batch.getDownloadStatus().bytesDownloaded > 0);
  batch.setMaxDownloadSpeedBytesPerSecond(null);
  await run;
  f.verify();
});

it("expired prefetched links refresh once without replacing already saved bytes", async (t) => {
  const f = await fixture(t, Array<number>(5).fill(32 * 1024));
  f.settings.expired = true;
  await f.make().startDownload();
  assert.equal(f.links.length, 10);
  f.verify();
});

it("network reconnect reaches every active worker and keeps exact output", async (t) => {
  const f = await fixture(t, Array<number>(4).fill(512 * 1024));
  const batch = f.make();
  const run = batch.startDownload();
  await waitUntil(() =>
    batch.getFiles().every((file) => file.bytesDownloaded > 16384)
  );
  batch.setReconnecting(true);
  assert.equal(batch.getDownloadStatus().isReconnecting, true);
  batch.reconnect();
  batch.setReconnecting(false);
  await run;
  assert.ok(f.requests.filter((request) => request.start > 0).length >= 4);
  f.verify();
});

it("empty files finish in their original folders without requesting links", async (t) => {
  const f = await fixture(t, [0, 0, 0]);
  const batch = f.make();
  await batch.startDownload();
  assert.equal(f.links.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(batch.getDownloadStatus().progress, 1);
  f.verify();
});

it("small files with saved sparse ranges still use one connection per file", async (t) => {
  const size = 512 * 1024;
  const f = await fixture(t, Array<number>(4).fill(size));
  fs.mkdirSync(path.join(f.root, "folder/sub"), { recursive: true });
  for (let index = 0; index < 4; index++) {
    const filename = path.join(f.root, `folder/sub/file-${index}.bin`);
    const body = Buffer.alloc(size);
    body.fill(index + 1, 128 * 1024, 256 * 1024);
    fs.writeFileSync(filename, body);
    await rangeState.saveRangeState(filename, {
      version: 1,
      total: size,
      validator: '"fixture-v1"',
      resourceId: rangeState.rangeResourceId(`fixture:${index}`),
      ranges: [[128 * 1024, 256 * 1024]],
    });
  }
  await f.make().startDownload();
  assert.ok(f.peak() <= 4);
  f.verify();
});
