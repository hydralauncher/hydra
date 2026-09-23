import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  downloadParallelRanges,
  getRangeSizeForRequestBudget,
  getRangeTotal,
  PARALLEL_RANGE_SIZE,
  ParallelRangeUnsupportedError,
} from "./parallel-range-download.ts";

const total = PARALLEL_RANGE_SIZE * 4 + 1024 * 1024;
const contents = Buffer.allocUnsafe(total);
for (let index = 0; index < contents.length; index++) {
  contents[index] = index % 251;
}

const temporaryDirectories: string[] = [];
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  );
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        fs.promises.rm(directory, { recursive: true, force: true })
      )
  );
});

async function startServer(
  breakSecondRange = false,
  hangRangeStart?: number,
  hangOtherRanges = false
) {
  let active = 0;
  let peakActive = 0;
  let rangeRequests = 0;
  const server = http.createServer((request, response) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
    if (!match) {
      response.writeHead(200, { "content-length": contents.length });
      response.end(contents);
      return;
    }

    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), contents.length - 1);
    rangeRequests++;
    if (start === hangRangeStart || (hangOtherRanges && start !== 0)) return;
    if (breakSecondRange && start === PARALLEL_RANGE_SIZE * 4) {
      response.writeHead(200, { "content-length": contents.length });
      response.end(contents);
      return;
    }

    active++;
    peakActive = Math.max(peakActive, active);
    response.once("close", () => active--);
    response.writeHead(206, {
      "content-range": `bytes ${start}-${end}/${contents.length}`,
      "content-length": end - start + 1,
      etag: '"test-content"',
    });
    let offset = start;
    const timer = setInterval(() => {
      if (offset > end || response.destroyed) {
        clearInterval(timer);
        response.end();
        return;
      }
      const next = Math.min(offset + 64 * 1024, end + 1);
      response.write(contents.subarray(offset, next));
      offset = next;
    }, 1);
    response.once("close", () => clearInterval(timer));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}/file`,
    getPeakActive: () => peakActive,
    getRangeRequests: () => rangeRequests,
  };
}

async function runDownload(
  url: string,
  startByte = 0,
  onReadPending: (offset: number, pending: boolean) => void = () => undefined,
  rangeSize = PARALLEL_RANGE_SIZE,
  maxRanges?: number,
  abortAfterBytes?: number,
  connectionCount?: number
) {
  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "hydra-range-test-")
  );
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "download");
  await fs.promises.writeFile(filePath, contents.subarray(0, startByte));
  const end = startByte + rangeSize - 1;
  const controller = new AbortController();
  const firstResponse = await fetch(url, {
    headers: { Range: `bytes=${startByte}-${end}` },
    signal: controller.signal,
  });
  assert.equal(getRangeTotal(firstResponse, startByte, end), total);
  let countedBytes = 0;
  const download = downloadParallelRanges({
    url,
    headers: {},
    firstResponse,
    filePath,
    startByte,
    total,
    rangeSize,
    connectionCount,
    maxRanges,
    signal: controller.signal,
    abort: () => controller.abort(),
    beforeChunk: async () => undefined,
    afterChunk: (length) => {
      countedBytes += length;
      if (abortAfterBytes && countedBytes >= abortAfterBytes) {
        controller.abort();
      }
    },
    onReadPending,
  });
  return {
    download,
    filePath,
    abort: () => controller.abort(),
    getCountedBytes: () => countedBytes,
  };
}

describe("parallel HTTP byte ranges", () => {
  it("downloads exact bytes over concurrent requests", async () => {
    const server = await startServer();
    const { download, filePath, getCountedBytes } = await runDownload(
      server.url
    );
    await download;
    assert.deepEqual(await fs.promises.readFile(filePath), contents);
    assert.equal(getCountedBytes(), total);
    assert.ok(server.getPeakActive() >= 2);
  });

  it("uses the requested connection count", async () => {
    const server = await startServer();
    const { download, filePath } = await runDownload(
      server.url,
      0,
      () => undefined,
      PARALLEL_RANGE_SIZE,
      undefined,
      undefined,
      2
    );
    await download;
    assert.deepEqual(await fs.promises.readFile(filePath), contents);
    assert.equal(server.getPeakActive(), 2);
  });

  it("appends to a previously downloaded prefix", async () => {
    const server = await startServer();
    const startByte = 1024 * 1024;
    const { download, filePath } = await runDownload(server.url, startByte);
    await download;
    assert.deepEqual(await fs.promises.readFile(filePath), contents);
  });

  it("commits the first partial range when a transfer is paused", async () => {
    const server = await startServer(false, undefined, true);
    const { download, filePath } = await runDownload(
      server.url,
      0,
      () => undefined,
      PARALLEL_RANGE_SIZE,
      undefined,
      128 * 1024
    );
    await assert.rejects(download);
    const saved = await fs.promises.readFile(filePath);
    assert.ok(saved.length >= 128 * 1024);
    assert.ok(saved.length < PARALLEL_RANGE_SIZE);
    assert.deepEqual(saved, contents.subarray(0, saved.length));
  });

  it("uses larger ranges to reduce requests for large files", async () => {
    const server = await startServer();
    const rangeSize = PARALLEL_RANGE_SIZE * 2;
    const { download, filePath } = await runDownload(
      server.url,
      0,
      () => undefined,
      rangeSize
    );
    assert.equal(await download, true);
    assert.equal(server.getRangeRequests(), 3);
    assert.deepEqual(await fs.promises.readFile(filePath), contents);
  });

  it("commits a prefix before the range request budget is reached", async () => {
    const server = await startServer();
    const { download, filePath } = await runDownload(
      server.url,
      0,
      () => undefined,
      PARALLEL_RANGE_SIZE,
      4
    );
    assert.equal(await download, false);
    assert.equal(server.getRangeRequests(), 4);
    assert.deepEqual(
      await fs.promises.readFile(filePath),
      contents.subarray(0, PARALLEL_RANGE_SIZE * 4)
    );
  });

  it("plans fewer than 256 range requests for the stalled file size", () => {
    const rangeSize = getRangeSizeForRequestBudget(3056294936, 256);
    assert.equal(rangeSize, PARALLEL_RANGE_SIZE * 2);
    assert.ok(Math.ceil(3056294936 / rangeSize) < 256);
  });

  it("leaves completed batches intact when a later request ignores Range", async () => {
    const server = await startServer(true);
    const { download, filePath } = await runDownload(server.url);
    await assert.rejects(download, ParallelRangeUnsupportedError);
    const saved = await fs.promises.readFile(filePath);
    assert.equal(saved.length, PARALLEL_RANGE_SIZE * 4);
    assert.deepEqual(saved, contents.subarray(0, saved.length));
  });

  it("reports a range waiting for response headers so a stall can abort it", async () => {
    const server = await startServer(false, PARALLEL_RANGE_SIZE);
    let reportPending: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      reportPending = resolve;
    });
    const { download, abort } = await runDownload(
      server.url,
      0,
      (offset, isPending) => {
        if (offset === PARALLEL_RANGE_SIZE && isPending) reportPending();
      }
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Range wait was not reported")),
            2000
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      abort();
    }
    await assert.rejects(download);
  });

  it("rejects a mismatched Content-Range", () => {
    const response = new Response(null, {
      status: 206,
      headers: { "content-range": "bytes 5-9/100" },
    });
    assert.equal(getRangeTotal(response, 0, 4), null);
  });
});
