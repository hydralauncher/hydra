import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { it } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as helpers from "./js-http-downloader-helpers.ts";
import * as parallel from "./parallel-range-download.ts";
import * as rangeState from "./range-download-state.ts";
import type { JsHttpDownloader as DownloaderType } from "./js-http-downloader.ts";

// Load the real downloader without starting Electron's log transport.
const code = ts.transpileModule(
  fs.readFileSync(new URL("./js-http-downloader.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }
).outputText;
const exports: Record<string, unknown> = {};
runInNewContext(code, {
  exports,
  require: (id: string) => {
    const dependencies: Record<string, unknown> = {
      "node:fs": fs,
      "node:path": path,
      "node:stream": { Readable },
      "node:stream/promises": { pipeline },
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
      "./js-http-downloader-helpers": helpers,
      "./parallel-range-download": parallel,
      "./range-download-state": rangeState,
    };
    assert.ok(id in dependencies, `Unexpected downloader dependency: ${id}`);
    return dependencies[id];
  },
  Buffer,
  URL,
  AbortController,
  Error,
  TypeError,
  DOMException,
  fetch,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
});
const JsHttpDownloader = exports.JsHttpDownloader as typeof DownloaderType;

interface FixtureOptions {
  etag?: string | null;
  ignoreRange?: boolean;
  size?: number;
  modified?: string | null;
  date?: string | null;
  contentType?: string;
  failNextStatus?: number;
  failRequests?: Record<number, number>;
  failureDelay?: number;
  disconnectOnce?: boolean;
  hangHeaders?: boolean;
}
async function fixture(options: FixtureOptions = {}) {
  const data = Buffer.alloc(options.size ?? 1024 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const requests: {
    start: number;
    end: number;
    range?: string;
    ifRange?: string;
  }[] = [];
  let active = 0;
  let peak = 0;
  const server = http.createServer((req, res) => {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    const start = match && !options.ignoreRange ? Number(match[1]) : 0;
    const end =
      match?.[2] && !options.ignoreRange
        ? Math.min(Number(match[2]), data.length - 1)
        : data.length - 1;
    requests.push({
      start,
      end,
      range: req.headers.range,
      ifRange: req.headers["if-range"] as string | undefined,
    });
    if (options.hangHeaders) return;
    if (options.failNextStatus || options.failRequests?.[requests.length]) {
      const status =
        options.failNextStatus ?? options.failRequests![requests.length];
      delete options.failNextStatus;
      setTimeout(() => {
        res.writeHead(status, { "Content-Length": 0, "Retry-After": "0" });
        res.end();
      }, options.failureDelay ?? 0);
      return;
    }
    res.setHeader(
      "Content-Type",
      options.contentType ?? "application/octet-stream"
    );
    res.setHeader("Accept-Ranges", "bytes");
    if (options.modified !== null)
      res.setHeader(
        "Last-Modified",
        options.modified ?? "Tue, 17 Feb 2026 19:55:52 GMT"
      );
    if (options.date === null) res.sendDate = false;
    else if (options.date) res.setHeader("Date", options.date);
    if (options.etag !== null)
      res.setHeader("ETag", options.etag ?? '"fixture-v1"');
    if (data.length > 0 && start >= data.length) {
      res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
      res.end();
      return;
    }
    if (data.length > 0 && match && !options.ignoreRange) {
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${data.length}`);
    }
    res.setHeader("Content-Length", end - start + 1);
    active++;
    peak = Math.max(peak, active);
    let cursor = start;
    const timer = setInterval(() => {
      if (cursor > end) {
        res.end();
        return;
      }
      const next = Math.min(cursor + 4096, end + 1);
      res.write(data.subarray(cursor, next));
      cursor = next;
      if (options.disconnectOnce && cursor - start >= 32 * 1024) {
        options.disconnectOnce = false;
        res.destroy();
      }
    }, 4);
    res.once("close", () => {
      clearInterval(timer);
      active--;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-http-test-"));
  return {
    data,
    root,
    requests,
    url: `http://127.0.0.1:${address.port}/file`,
    peak: () => peak,
    options: {
      url: `http://127.0.0.1:${address.port}/file`,
      savePath: root,
      filename: "folder/sub/file.bin",
      preserveFilename: true,
      parallelRangeSize: 128 * 1024,
      parallelRangeConnections: 4,
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}
async function waitUntil(check: () => boolean, timeout = 4000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout)
      throw new Error("Download condition timed out");
    await delay(5);
  }
}

it("uses parallel ranges for TorBox-style responses without ETags", async () => {
  const f = await fixture({ etag: null });
  try {
    const d = new JsHttpDownloader();
    await d.startDownload(f.options);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.ok(
      f.peak() > 1,
      "Valid Last-Modified ranges should use multiple connections"
    );
  } finally {
    await f.close();
  }
});

it("pause preserves every byte already received by parallel workers", async () => {
  const f = await fixture();
  try {
    const d = new JsHttpDownloader();
    const running = d.startDownload(f.options);
    await waitUntil(
      () => (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= 80 * 1024
    );
    const beforePause = d.getDownloadStatus()!.bytesDownloaded;
    d.pauseDownload();
    await running;
    assert.ok(
      d.getDownloadStatus()!.bytesDownloaded >= beforePause,
      "Pause discarded received range bytes"
    );
  } finally {
    await f.close();
  }
});

it("a new downloader requests only missing ranges after pause", async () => {
  const f = await fixture();
  try {
    const first = new JsHttpDownloader();
    const running = first.startDownload({
      ...f.options,
      resourceId: "torbox:test-file",
    });
    await waitUntil(
      () => (first.getDownloadStatus()?.bytesDownloaded ?? 0) >= 100 * 1024
    );
    first.pauseDownload();
    await running;
    const output = path.join(f.root, f.options.filename);
    const saved = rangeState.readRangeState(output)!;
    assert.equal(
      rangeState.savedRangeBytes(saved),
      first.getDownloadStatus()!.bytesDownloaded
    );
    assert.ok(
      saved.ranges.length > 1,
      "Fixture should retain out-of-order data"
    );
    const boundary = f.requests.length;
    const resumed = new JsHttpDownloader();
    await resumed.startDownload({
      ...f.options,
      url: f.url + "?fresh-link=true",
      resourceId: "torbox:test-file",
    });
    for (const request of f.requests.slice(boundary)) {
      for (const [start, end] of saved.ranges) {
        assert.ok(
          request.end < start || request.start >= end,
          "Resume requested already saved bytes"
        );
      }
      assert.equal(request.ifRange, saved.validator);
    }
    assert.deepEqual(fs.readFileSync(output), f.data);
    assert.equal(resumed.getDownloadStatus()!.bytesDownloaded, f.data.length);
    assert.equal(resumed.getDownloadStatus()!.status, "complete");
    assert.equal(fs.existsSync(rangeState.rangeStatePath(output)), false);
  } finally {
    await f.close();
  }
});

it("repeated pause and resume retains progress and exact content", async () => {
  const f = await fixture({ etag: null });
  try {
    let previous = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = new JsHttpDownloader();
      const running = d.startDownload(f.options);
      await waitUntil(
        () =>
          (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= previous + 64 * 1024
      );
      d.pauseDownload();
      await running;
      const bytes = d.getDownloadStatus()!.bytesDownloaded;
      assert.ok(bytes > previous);
      assert.equal(
        bytes,
        rangeState.getRangeDownloadedBytes(
          path.join(f.root, f.options.filename)
        )
      );
      previous = bytes;
    }
    const d = new JsHttpDownloader();
    await d.startDownload(f.options);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});

it("changed validators preserve the saved file and stop resume", async () => {
  const behavior: FixtureOptions = {};
  const f = await fixture(behavior);
  try {
    const d = new JsHttpDownloader();
    const running = d.startDownload(f.options);
    await waitUntil(
      () => (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= 64 * 1024
    );
    d.pauseDownload();
    await running;
    const output = path.join(f.root, f.options.filename);
    const before = fs.readFileSync(output);
    behavior.etag = '"fixture-v2"';
    const resumed = new JsHttpDownloader();
    await assert.rejects(
      resumed.startDownload(f.options),
      /cannot safely resume/
    );
    assert.deepEqual(fs.readFileSync(output), before);
    assert.equal(resumed.getDownloadStatus()!.status, "error");
  } finally {
    await f.close();
  }
});

it("a different resource ID cannot reuse another download's range map", async () => {
  const f = await fixture();
  try {
    const d = new JsHttpDownloader();
    const running = d.startDownload({ ...f.options, resourceId: "one" });
    await waitUntil(
      () => (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= 64 * 1024
    );
    d.pauseDownload();
    await running;
    const boundary = f.requests.length;
    await assert.rejects(
      new JsHttpDownloader().startDownload({ ...f.options, resourceId: "two" }),
      /different download/
    );
    assert.equal(f.requests.length, boundary);
  } finally {
    await f.close();
  }
});

it("a ranged download refuses a later full response without replay", async () => {
  const behavior: FixtureOptions = {};
  const f = await fixture(behavior);
  try {
    const d = new JsHttpDownloader();
    const running = d.startDownload(f.options);
    await waitUntil(
      () => (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= 64 * 1024
    );
    d.pauseDownload();
    await running;
    const output = path.join(f.root, f.options.filename);
    const before = fs.readFileSync(output);
    behavior.ignoreRange = true;
    await assert.rejects(
      new JsHttpDownloader().startDownload(f.options),
      /cannot safely resume/
    );
    assert.deepEqual(fs.readFileSync(output), before);
  } finally {
    await f.close();
  }
});

it("servers without range support still finish a fresh file", async () => {
  const f = await fixture({ ignoreRange: true });
  try {
    const d = new JsHttpDownloader();
    await d.startDownload(f.options);
    assert.equal(f.peak(), 1);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.equal(d.getDownloadStatus()!.resumeCapability, "unsupported");
  } finally {
    await f.close();
  }
});

it("legacy partial files resume with a bounded overlap", async () => {
  const f = await fixture();
  try {
    const output = path.join(f.root, f.options.filename);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, f.data.subarray(0, 128 * 1024));
    const d = new JsHttpDownloader();
    await d.startDownload({ ...f.options, requireRangeResume: true });
    assert.equal(f.requests[0].start, 64 * 1024);
    assert.deepEqual(fs.readFileSync(output), f.data);
    assert.equal(d.getDownloadStatus()!.isRecovering, false);
  } finally {
    await f.close();
  }
});

it("legacy TorBox partials stop if the server ignores Range", async () => {
  const f = await fixture({ ignoreRange: true });
  try {
    const output = path.join(f.root, f.options.filename);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const before = f.data.subarray(0, 128 * 1024);
    fs.writeFileSync(output, before);
    await assert.rejects(
      new JsHttpDownloader().startDownload({
        ...f.options,
        requireRangeResume: true,
      }),
      /ignored the resume request/
    );
    assert.deepEqual(fs.readFileSync(output), before);
  } finally {
    await f.close();
  }
});

it("a corrupt legacy overlap leaves its partial file intact", async () => {
  const f = await fixture();
  try {
    const output = path.join(f.root, f.options.filename);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const before = Buffer.alloc(128 * 1024, 255);
    fs.writeFileSync(output, before);
    await assert.rejects(
      new JsHttpDownloader().startDownload(f.options),
      /remote archive changed/
    );
    assert.deepEqual(fs.readFileSync(output), before);
  } finally {
    await f.close();
  }
});

it("parallel request budgets finish the remainder through one connection", async () => {
  const f = await fixture();
  try {
    await new JsHttpDownloader().startDownload({
      ...f.options,
      maxParallelRanges: 2,
    });
    assert.equal(f.requests.length, 3);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.equal(f.requests[2].start, 256 * 1024);
  } finally {
    await f.close();
  }
});

it("one interrupted range retries and preserves exact output", async () => {
  const f = await fixture({ disconnectOnce: true });
  try {
    const d = new JsHttpDownloader();
    await d.startDownload(f.options);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.equal(d.getDownloadStatus()!.isReconnecting, false);
    assert.ok(f.requests.length > 8);
  } finally {
    await f.close();
  }
});

it("expired direct links refresh once and finish", async () => {
  const f = await fixture({ failNextStatus: 403 });
  let refreshes = 0;
  try {
    const d = new JsHttpDownloader();
    await d.startDownload({
      ...f.options,
      refreshUrl: async () => {
        refreshes++;
        return f.url + "?refreshed";
      },
    });
    assert.equal(refreshes, 1);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});

it("retryable status responses recover before any file data is written", async () => {
  const f = await fixture({ failNextStatus: 503 });
  try {
    await new JsHttpDownloader().startDownload(f.options);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});

it("a wrong expected size cannot overwrite existing data", async () => {
  const f = await fixture();
  try {
    const output = path.join(f.root, f.options.filename);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const before = f.data.subarray(0, 128 * 1024);
    fs.writeFileSync(output, before);
    await assert.rejects(
      new JsHttpDownloader().startDownload({
        ...f.options,
        expectedSize: f.data.length + 1,
      }),
      /different file size/
    );
    assert.deepEqual(fs.readFileSync(output), before);
  } finally {
    await f.close();
  }
});

it("HTML error responses never become downloaded files", async () => {
  const f = await fixture({ contentType: "text/html" });
  try {
    await assert.rejects(
      new JsHttpDownloader().startDownload(f.options),
      /web page instead of a file/
    );
    assert.equal(fs.existsSync(path.join(f.root, f.options.filename)), false);
  } finally {
    await f.close();
  }
});

it("pause aborts a request still waiting for response headers", async () => {
  const f = await fixture({ hangHeaders: true });
  try {
    const d = new JsHttpDownloader();
    const running = d.startDownload(f.options);
    await waitUntil(() => f.requests.length > 0);
    const before = Date.now();
    d.pauseDownload();
    await running;
    assert.ok(Date.now() - before < 500);
    assert.equal(d.getDownloadStatus()!.status, "paused");
    assert.equal(d.getDownloadStatus()!.bytesDownloaded, 0);
  } finally {
    await f.close();
  }
});

it("duplicate start calls share the active transfer", async () => {
  const f = await fixture();
  try {
    const d = new JsHttpDownloader();
    const one = d.startDownload(f.options);
    const two = d.startDownload(f.options);
    await Promise.all([one, two]);
    assert.equal(f.requests.length, 8);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});

it("explicit speed limits apply to all range workers together", async () => {
  const f = await fixture({ size: 128 * 1024 });
  try {
    const d = new JsHttpDownloader();
    d.setMaxDownloadSpeedBytesPerSecond(64 * 1024);
    const before = Date.now();
    await d.startDownload({ ...f.options, parallelRangeSize: 16 * 1024 });
    const elapsed = Date.now() - before;
    assert.ok(elapsed >= 1900, `Aggregate cap was bypassed: ${elapsed}ms`);
    assert.ok(
      elapsed < 3500,
      `Cap unnecessarily reduced throughput: ${elapsed}ms`
    );
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});

for (const limit of [0, null, -1, NaN, Infinity]) {
  it(`unlimited normalization (${String(limit)}) introduces no pacing delay`, async () => {
    const f = await fixture({ size: 64 * 1024 });
    try {
      const d = new JsHttpDownloader();
      d.setMaxDownloadSpeedBytesPerSecond(limit);
      const before = Date.now();
      await d.startDownload(f.options);
      assert.ok(Date.now() - before < 4000);
      assert.deepEqual(
        fs.readFileSync(path.join(f.root, f.options.filename)),
        f.data
      );
    } finally {
      await f.close();
    }
  });
}

it("changing a speed limit to Unlimited unblocks waiting workers", async () => {
  const f = await fixture({ size: 128 * 1024 });
  try {
    const d = new JsHttpDownloader();
    d.setMaxDownloadSpeedBytesPerSecond(1);
    const running = d.startDownload({
      ...f.options,
      parallelRangeSize: 16 * 1024,
    });
    await waitUntil(() => f.requests.length > 1);
    const before = Date.now();
    d.setMaxDownloadSpeedBytesPerSecond(0);
    await running;
    assert.ok(Date.now() - before < 4000);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});

it("zero-byte files complete without a link or HTTP request", async () => {
  const f = await fixture({ size: 0 });
  try {
    const d = new JsHttpDownloader();
    await d.startDownload({
      ...f.options,
      url: "about:blank",
      expectedSize: 0,
    });
    assert.equal(f.requests.length, 0);
    assert.equal(fs.statSync(path.join(f.root, f.options.filename)).size, 0);
    assert.equal(d.getDownloadStatus()!.status, "complete");
  } finally {
    await f.close();
  }
});

it("cancel removes a paused partial and its range map", async () => {
  const f = await fixture();
  try {
    const d = new JsHttpDownloader();
    const running = d.startDownload(f.options);
    await waitUntil(
      () => (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= 64 * 1024
    );
    d.pauseDownload();
    await running;
    d.cancelDownload();
    const output = path.join(f.root, f.options.filename);
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(rangeState.rangeStatePath(output)), false);
  } finally {
    await f.close();
  }
});

it("reconnect saves all ranges and resumes without replaying them", async () => {
  const f = await fixture();
  try {
    const d = new JsHttpDownloader();
    const run = d.startDownload(f.options);
    await waitUntil(
      () => (d.getDownloadStatus()?.bytesDownloaded ?? 0) >= 64 * 1024
    );
    d.reconnect();
    await run;
    assert.equal(d.getDownloadStatus()!.status, "complete");
    assert.equal(d.getDownloadStatus()!.isReconnecting, false);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.ok(f.requests.slice(4).every((r) => r.start > 0));
  } finally {
    await f.close();
  }
});
it("pause interrupts speed-limit waits without saving unwritten bytes", async () => {
  const f = await fixture();
  try {
    const d = new JsHttpDownloader();
    d.setMaxDownloadSpeedBytesPerSecond(1);
    const run = d.startDownload(f.options);
    await waitUntil(() => f.requests.length === 4);
    const started = Date.now();
    d.pauseDownload();
    await run;
    assert.ok(Date.now() - started < 500);
    assert.equal(d.getDownloadStatus()!.bytesDownloaded, 0);
    assert.equal(
      rangeState.getRangeDownloadedBytes(path.join(f.root, f.options.filename)),
      0
    );
  } finally {
    await f.close();
  }
});
for (const headers of [
  { etag: null, modified: null },
  { etag: 'W/"v1"' },
  { etag: null, date: null },
]) {
  it(`uses one connection when no safe validator exists ${JSON.stringify(headers)}`, async () => {
    const f = await fixture({ ...headers, size: 128 * 1024 });
    try {
      const d = new JsHttpDownloader();
      await d.startDownload({ ...f.options, parallelRangeSize: 16 * 1024 });
      assert.equal(f.requests.length, 2);
      assert.equal(f.requests[1].range, undefined);
      assert.deepEqual(
        fs.readFileSync(path.join(f.root, f.options.filename)),
        f.data
      );
    } finally {
      await f.close();
    }
  });
}
it("finishes a fully checkpointed file without any HTTP request", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, f.options.filename);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, f.data);
    await rangeState.saveRangeState(file, {
      version: 1,
      total: f.data.length,
      validator: '"fixture-v1"',
      resourceId: null,
      ranges: [[0, f.data.length]],
    });
    const d = new JsHttpDownloader();
    await d.startDownload(f.options);
    assert.equal(f.requests.length, 0);
    assert.equal(d.getDownloadStatus()!.status, "complete");
    assert.equal(fs.existsSync(rangeState.rangeStatePath(file)), false);
  } finally {
    await f.close();
  }
});
it("a zero-byte manifest does not overwrite an existing nonempty file", async () => {
  const f = await fixture();
  try {
    const file = path.join(f.root, f.options.filename);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "saved");
    const d = new JsHttpDownloader();
    await assert.rejects(
      () => d.startDownload({ ...f.options, expectedSize: 0 }),
      /Keeping the saved file/
    );
    assert.equal(fs.readFileSync(file, "utf8"), "saved");
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

it("an expired parallel chunk refreshes the link without downgrading connections", async () => {
  const f = await fixture({ failRequests: { 2: 403 }, failureDelay: 25 });
  let refreshes = 0;
  try {
    await new JsHttpDownloader().startDownload({
      ...f.options,
      refreshUrl: async () => {
        refreshes++;
        return f.url + "?fresh=" + refreshes;
      },
    });
    assert.equal(refreshes, 1);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.ok(f.requests.slice(4).some((r) => r.end - r.start < 256 * 1024));
  } finally {
    await f.close();
  }
});
it("separate link expirations can refresh again after verified progress", async () => {
  const f = await fixture({
    failRequests: { 2: 403, 6: 403 },
    failureDelay: 40,
  });
  let refreshes = 0;
  try {
    await new JsHttpDownloader().startDownload({
      ...f.options,
      refreshUrl: async () => {
        refreshes++;
        return f.url + "?fresh=" + refreshes;
      },
    });
    assert.equal(refreshes, 2);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
  } finally {
    await f.close();
  }
});
it("parallel rate limiting honors status retries and preserves parallel ranges", async () => {
  const f = await fixture({ failRequests: { 2: 429 }, failureDelay: 25 });
  try {
    await new JsHttpDownloader().startDownload(f.options);
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, f.options.filename)),
      f.data
    );
    assert.ok(f.requests.slice(4).some((r) => r.end - r.start < 256 * 1024));
  } finally {
    await f.close();
  }
});

it("an immediately invalid refreshed URL cannot cause a refresh loop", async () => {
  const f = await fixture({ failRequests: { 1: 403, 2: 403 } });
  let refreshes = 0;
  try {
    await assert.rejects(
      () =>
        new JsHttpDownloader().startDownload({
          ...f.options,
          refreshUrl: async () => {
            refreshes++;
            return f.url + "?fresh";
          },
        }),
      /HTTP.*403/
    );
    assert.equal(refreshes, 1);
    assert.equal(f.requests.length, 2);
  } finally {
    await f.close();
  }
});

it("reuses the open-ended Real-Debrid response when range validators are absent", async () => {
  const f = await fixture({ etag: null, modified: null, date: null });
  try {
    const d = new JsHttpDownloader();
    await d.startDownload({
      ...f.options,
      filename: "unbounded.bin",
      preserveFilename: true,
      expectedSize: f.data.length,
      requireRangeResume: true,
      probeUnboundedRange: true,
    });
    assert.equal(d.getDownloadStatus()?.status, "complete");
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, "unbounded.bin")),
      f.data
    );
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].range, "bytes=0-");
  } finally {
    await f.close();
  }
});
it("keeps parallel range validation when an open-ended probe has a strong validator", async () => {
  const f = await fixture({ size: 1024 * 1024 });
  try {
    const d = new JsHttpDownloader();
    await d.startDownload({
      ...f.options,
      filename: "unbounded-parallel.bin",
      preserveFilename: true,
      parallelRangeSize: 128 * 1024,
      expectedSize: f.data.length,
      probeUnboundedRange: true,
    });
    assert.equal(d.getDownloadStatus()?.status, "complete");
    assert.deepEqual(
      fs.readFileSync(path.join(f.root, "unbounded-parallel.bin")),
      f.data
    );
    assert.equal(f.requests[0].range, "bytes=0-");
    assert.ok(f.requests.length > 2);
    assert.ok(f.requests.slice(2).every((r) => r.ifRange === '"fixture-v1"'));
  } finally {
    await f.close();
  }
});
