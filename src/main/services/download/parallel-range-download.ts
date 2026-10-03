import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const PARALLEL_RANGE_SIZE = 8 * 1024 * 1024;
export const PARALLEL_RANGE_COUNT = 4;
export const MAX_PARALLEL_RANGE_SIZE = 256 * 1024 * 1024;

export function getRangeSizeForRequestBudget(
  totalBytes: number,
  maxRanges: number
): number {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    return PARALLEL_RANGE_SIZE;
  }
  const units = Math.ceil(totalBytes / (maxRanges * PARALLEL_RANGE_SIZE));
  return Math.min(
    MAX_PARALLEL_RANGE_SIZE,
    Math.max(PARALLEL_RANGE_SIZE, units * PARALLEL_RANGE_SIZE)
  );
}

export class ParallelRangeUnsupportedError extends Error {
  readonly retryable = true;
}

export function shouldDowngradeParallelRanges(
  error: unknown,
  failureCount: number
): boolean {
  return error instanceof ParallelRangeUnsupportedError || failureCount >= 2;
}

export function getRangeTotal(
  response: Response,
  start: number,
  end: number
): number | null {
  if (response.status !== 206) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(
    response.headers.get("content-range") ?? ""
  );
  if (!match) return null;

  const [, actualStart, actualEnd, totalValue] = match;
  const total = Number(totalValue);
  const encoding = response.headers.get("content-encoding")?.toLowerCase();
  if (
    Number(actualStart) !== start ||
    Number(actualEnd) !== Math.min(end, total - 1) ||
    !Number.isSafeInteger(total) ||
    total <= start ||
    (encoding && encoding !== "identity")
  ) {
    return null;
  }

  const length = response.headers.get("content-length");
  if (length && Number(length) !== Number(actualEnd) - start + 1) {
    return null;
  }
  return total;
}

export function getStrongRangeValidator(response: Response): string | null {
  const etag = response.headers.get("etag");
  // Last-Modified and weak ETags do not establish byte-for-byte identity.
  return etag && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? etag : null;
}

export function getRangeResumeCapability(
  response: Response,
  requestedRange: string | undefined,
  ifRange?: string
): "unknown" | "supported" | "unsupported" {
  const range = /^bytes=(\d+)-(\d*)$/.exec(requestedRange ?? "");
  if (!range) return "unknown";
  if (
    /^(text\/html|application\/xhtml)/i.test(
      response.headers.get("content-type") ?? ""
    )
  ) {
    return "unknown";
  }
  // A changed If-Range validator legitimately returns the entire resource.
  if (response.status === 200) return ifRange ? "unknown" : "unsupported";
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : Number.MAX_SAFE_INTEGER;
  return getRangeTotal(response, start, end) !== null ? "supported" : "unknown";
}

export interface ParallelRangeDownloadOptions {
  url: string;
  headers: Record<string, string>;
  firstResponse: Response;
  filePath: string;
  startByte: number;
  total: number;
  rangeSize?: number;
  connectionCount?: number;
  maxRanges?: number;
  signal: AbortSignal;
  abort: () => void;
  beforeChunk: (length: number) => Promise<void>;
  afterChunk: (length: number) => void;
  onReadPending: (offset: number, pending: boolean) => void;
}

interface ByteRange {
  start: number;
  end: number;
  tempFile: string;
}

type RangeContext = Pick<
  ParallelRangeDownloadOptions,
  | "url"
  | "headers"
  | "total"
  | "signal"
  | "beforeChunk"
  | "afterChunk"
  | "onReadPending"
> & { validator: string };

async function fetchRangeResponse(
  context: RangeContext,
  range: ByteRange,
  response?: Response
): Promise<Response> {
  if (response) return response;
  const { start, end } = range;
  context.onReadPending(start, true);
  try {
    return await fetch(context.url, {
      headers: {
        ...context.headers,
        Range: `bytes=${start}-${end}`,
        "If-Range": context.validator,
      },
      signal: context.signal,
    });
  } finally {
    context.onReadPending(start, false);
  }
}

async function assertRangeResponse(
  response: Response,
  range: ByteRange,
  context: RangeContext
): Promise<void> {
  const { validator } = context;
  if (
    getRangeTotal(response, range.start, range.end) !== context.total ||
    getStrongRangeValidator(response) !== validator
  ) {
    await response.body?.cancel();
    throw new ParallelRangeUnsupportedError(
      "The download server stopped serving matching byte ranges"
    );
  }
}

async function writeRangeChunk(
  file: fs.promises.FileHandle,
  chunk: Uint8Array
): Promise<void> {
  let written = 0;
  while (written < chunk.length) {
    const result = await file.write(chunk, written, chunk.length - written);
    if (result.bytesWritten === 0) {
      throw new Error("Could not write the downloaded byte range");
    }
    written += result.bytesWritten;
  }
}

async function readRangeBody(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  file: fs.promises.FileHandle,
  range: ByteRange,
  context: RangeContext
): Promise<number> {
  let received = 0;
  for (;;) {
    context.onReadPending(range.start, true);
    let result: ReadableStreamReadResult<Uint8Array>;
    try {
      result = await reader.read();
    } finally {
      context.onReadPending(range.start, false);
    }
    if (result.done) return received;

    const chunk = result.value;
    if (received + chunk.length > range.end - range.start + 1) {
      throw new ParallelRangeUnsupportedError(
        "The download server sent more data than the requested byte range"
      );
    }
    await context.beforeChunk(chunk.length);
    if (context.signal.aborted) throw context.signal.reason;
    await writeRangeChunk(file, chunk);
    received += chunk.length;
    context.afterChunk(chunk.length);
  }
}

async function downloadRange(
  range: ByteRange,
  context: RangeContext,
  response?: Response
): Promise<void> {
  if (context.signal.aborted) throw context.signal.reason;
  const rangeResponse = await fetchRangeResponse(context, range, response);
  await assertRangeResponse(rangeResponse, range, context);
  if (!rangeResponse.body) throw new Error("Range response body is null");

  const reader = rangeResponse.body.getReader();
  let file: fs.promises.FileHandle;
  try {
    file = await fs.promises.open(range.tempFile, "w");
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw error;
  }

  let done = false;
  let received = 0;
  try {
    received = await readRangeBody(reader, file, range, context);
    done = true;
  } finally {
    try {
      await file.close();
    } finally {
      if (!done) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  const expected = range.end - range.start + 1;
  if (received !== expected) {
    const error = new Error(
      `Byte range ended early (received ${received}, expected ${expected})`
    ) as Error & { retryable: boolean };
    error.retryable = true;
    throw error;
  }
}

function planRanges(
  nextByte: number,
  total: number,
  rangeSize: number,
  connectionCount: number,
  remainingRanges: number,
  tempDir: string
): ByteRange[] {
  const ranges: ByteRange[] = [];
  for (
    let index = 0;
    index < connectionCount &&
    nextByte < total &&
    ranges.length < remainingRanges;
    index++
  ) {
    const end = Math.min(nextByte + rangeSize - 1, total - 1);
    ranges.push({
      start: nextByte,
      end,
      tempFile: path.join(tempDir, String(index)),
    });
    nextByte = end + 1;
  }
  return ranges;
}

async function commitFailedRanges(
  ranges: ByteRange[],
  filePath: string
): Promise<void> {
  for (const range of ranges) {
    const size = await fs.promises
      .stat(range.tempFile)
      .then((stats) => stats.size)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return 0;
        throw error;
      });
    if (size === 0) break;
    const expected = range.end - range.start + 1;
    if (size > expected) {
      throw new ParallelRangeUnsupportedError(
        "A downloaded byte range exceeded its expected length"
      );
    }
    await pipeline(
      fs.createReadStream(range.tempFile),
      fs.createWriteStream(filePath, { flags: "a" })
    );
    if (size < expected) break;
  }
}

async function commitCompletedRanges(
  ranges: ByteRange[],
  filePath: string,
  signal: AbortSignal
): Promise<void> {
  for (const range of ranges) {
    if (signal.aborted) throw signal.reason;
    await pipeline(
      fs.createReadStream(range.tempFile),
      fs.createWriteStream(filePath, { flags: "a" }),
      { signal }
    );
    await fs.promises.unlink(range.tempFile).catch(() => undefined);
  }
}

async function downloadRangeBatch(
  ranges: ByteRange[],
  context: RangeContext,
  firstResponse: Response,
  startByte: number,
  filePath: string,
  abort: () => void
): Promise<void> {
  const transfers = ranges.map((range, index) =>
    downloadRange(
      range,
      context,
      index === 0 && range.start === startByte ? firstResponse : undefined
    )
  );
  try {
    await Promise.all(transfers);
  } catch (error) {
    // Stop writers before reading their temporary files. Even when a batch
    // is incomplete, its first ranges may form a valid contiguous prefix.
    if (!context.signal.aborted) abort();
    await Promise.allSettled(transfers);
    await commitFailedRanges(ranges, filePath);
    throw error;
  }
  await commitCompletedRanges(ranges, filePath, context.signal);
}

export async function downloadParallelRanges({
  url,
  headers,
  firstResponse,
  filePath,
  startByte,
  total,
  rangeSize = PARALLEL_RANGE_SIZE,
  connectionCount = PARALLEL_RANGE_COUNT,
  maxRanges = Infinity,
  signal,
  abort,
  beforeChunk,
  afterChunk,
  onReadPending,
}: ParallelRangeDownloadOptions): Promise<boolean> {
  const validator = getStrongRangeValidator(firstResponse);
  if (!validator) {
    await firstResponse.body?.cancel().catch(() => undefined);
    throw new ParallelRangeUnsupportedError(
      "The download server did not provide a strong byte-range validator"
    );
  }
  let tempDir: string;
  try {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-ranges-")
    );
  } catch (error) {
    await firstResponse.body?.cancel().catch(() => undefined);
    throw error;
  }
  const context: RangeContext = {
    url,
    headers,
    total,
    signal,
    beforeChunk,
    afterChunk,
    onReadPending,
    validator,
  };

  let nextByte = startByte;
  let completedRanges = 0;
  try {
    while (nextByte < total && completedRanges < maxRanges) {
      const ranges = planRanges(
        nextByte,
        total,
        rangeSize,
        connectionCount,
        maxRanges - completedRanges,
        tempDir
      );
      const lastRange = ranges.at(-1);
      if (lastRange) nextByte = lastRange.end + 1;
      await downloadRangeBatch(
        ranges,
        context,
        firstResponse,
        startByte,
        filePath,
        abort
      );
      completedRanges += ranges.length;
    }
    return nextByte >= total;
  } finally {
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
