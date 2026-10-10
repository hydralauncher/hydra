import fs from "node:fs";
import {
  markSavedRange,
  missingRanges,
  rangeResourceId,
  readRangeState,
  removeRangeState,
  saveRangeState,
  type RangeDownloadState,
} from "./range-download-state.js";

const PARALLEL_RANGE_FAILURE_LIMIT = 2;
const STRONG_LAST_MODIFIED_AGE_MS = 60_000;

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

export class ParallelRangeHttpStatusError extends Error {
  constructor(
    readonly statusCode: number,
    readonly retryAfter: string | null
  ) {
    super(`Byte range server returned HTTP ${statusCode}`);
  }
}

export function shouldDowngradeParallelRanges(
  error: unknown,
  failureCount: number
): boolean {
  return (
    error instanceof ParallelRangeUnsupportedError ||
    failureCount >= PARALLEL_RANGE_FAILURE_LIMIT
  );
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
  if (etag !== null) {
    return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? etag : null;
  }
  const modified = response.headers.get("last-modified");
  const date = response.headers.get("date");
  // RFC 9110 8.8.2.2 permits a date validator when the clocks are far enough
  // apart. Keep the conservative 60-second margin used by older HTTP specs.
  return modified &&
    date &&
    Number.isFinite(Date.parse(modified)) &&
    Number.isFinite(Date.parse(date)) &&
    Date.parse(date) - Date.parse(modified) >= STRONG_LAST_MODIFIED_AGE_MS
    ? modified
    : null;
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
  resourceId?: string;
  signal: AbortSignal;
  abort: () => void;
  beforeChunk: (length: number) => Promise<void>;
  afterChunk: (length: number) => void;
  onReadPending: (offset: number, pending: boolean) => void;
}

interface ByteRange {
  start: number;
  end: number;
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
  resourceId,
  signal,
  abort,
  beforeChunk,
  afterChunk,
  onReadPending,
}: ParallelRangeDownloadOptions): Promise<boolean> {
  const validator = getStrongRangeValidator(firstResponse);
  if (!validator) {
    await firstResponse.body?.cancel();
    throw new ParallelRangeUnsupportedError(
      "The download server did not provide a byte-range validator"
    );
  }
  const saved = readRangeState(filePath);
  if (
    saved &&
    (saved.total !== total ||
      saved.validator !== validator ||
      saved.resourceId !== rangeResourceId(resourceId))
  ) {
    await firstResponse.body?.cancel();
    throw new Error(
      "The download resource changed. Keeping the saved partial file."
    );
  }
  if (
    !Number.isSafeInteger(rangeSize) ||
    rangeSize <= 0 ||
    !Number.isSafeInteger(connectionCount) ||
    connectionCount < 1 ||
    connectionCount > 16 ||
    !(
      maxRanges === Infinity ||
      (Number.isSafeInteger(maxRanges) && maxRanges > 0)
    )
  ) {
    await firstResponse.body?.cancel();
    throw new Error("Invalid parallel download limits");
  }
  const state: RangeDownloadState = saved ?? {
    version: 1,
    total,
    validator,
    resourceId: rangeResourceId(resourceId),
    ranges: startByte > 0 ? [[0, startByte]] : [],
  };
  const jobs: ByteRange[] = [];
  for (const [start, end] of missingRanges(state)) {
    for (let offset = start; offset < end && jobs.length < maxRanges; ) {
      const next = Math.min(offset + rangeSize, end);
      jobs.push({ start: offset, end: next - 1 });
      offset = next;
    }
    if (jobs.length >= maxRanges) break;
  }
  const file = await fs.promises.open(filePath, "r+");
  let lastCheckpoint = Date.now();
  let checkpoint: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    // Snapshot before sync so the map never claims bytes that sync did not see.
    const snapshot = {
      ...state,
      ranges: state.ranges.map(([start, end]): [number, number] => [
        start,
        end,
      ]),
    };
    checkpoint = checkpoint.then(async () => {
      await file.sync();
      await saveRangeState(filePath, snapshot);
    });
    return checkpoint;
  };
  let nextJob = 0;
  let firstUsed = false;
  const runRange = async (range: ByteRange): Promise<void> => {
    signal.throwIfAborted();
    let response: Response;
    const probeTotal = getRangeTotal(firstResponse, range.start, range.end);
    if (!firstUsed && probeTotal === total) {
      firstUsed = true;
      response = firstResponse;
    } else {
      onReadPending(range.start, true);
      try {
        response = await fetch(url, {
          headers: {
            ...headers,
            Range: `bytes=${range.start}-${range.end}`,
            "If-Range": validator,
          },
          signal,
        });
      } finally {
        onReadPending(range.start, false);
      }
    }
    if (
      getRangeTotal(response, range.start, range.end) !== total ||
      getStrongRangeValidator(response) !== validator
    ) {
      await response.body?.cancel();
      if (response.status >= 400) {
        throw new ParallelRangeHttpStatusError(
          response.status,
          response.headers.get("retry-after")
        );
      }
      throw new ParallelRangeUnsupportedError(
        "The download server stopped serving matching byte ranges"
      );
    }
    if (!response.body) throw new Error("Range response body is null");
    const reader = response.body.getReader();
    let received = 0;
    const writeChunk = async (
      chunk: Uint8Array,
      written = 0
    ): Promise<void> => {
      if (written === chunk.length) return;
      const offset = range.start + received;
      const result = await file.write(
        chunk,
        written,
        chunk.length - written,
        offset
      );
      if (!result.bytesWritten)
        throw new Error("Could not write the downloaded byte range");
      markSavedRange(state, offset, offset + result.bytesWritten);
      received += result.bytesWritten;
      afterChunk(result.bytesWritten);
      return writeChunk(chunk, written + result.bytesWritten);
    };
    try {
      const chunks: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            onReadPending(range.start, true);
            try {
              return await reader.read();
            } finally {
              onReadPending(range.start, false);
            }
          },
        }),
      };
      for await (const chunk of chunks) {
        if (received + chunk.length > range.end - range.start + 1) {
          throw new ParallelRangeUnsupportedError(
            "The server sent more data than the requested byte range"
          );
        }
        await beforeChunk(chunk.length);
        signal.throwIfAborted();
        await writeChunk(chunk);
        if (Date.now() - lastCheckpoint >= 1000) {
          lastCheckpoint = Date.now();
          await persist();
        }
        signal.throwIfAborted();
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (received !== range.end - range.start + 1) {
      const error = new Error(
        "Byte range ended before its expected size"
      ) as Error & { retryable: boolean };
      error.retryable = true;
      throw error;
    }
  };
  const worker = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const startNextRange = () => {
        try {
          signal.throwIfAborted();
          const job = jobs[nextJob++];
          if (!job) {
            resolve();
            return;
          }
          // Each worker retains one request, regardless of the queue length.
          runRange(job).then(startNextRange, reject);
        } catch (error) {
          reject(error);
        }
      };
      startNextRange();
    });
  let workers: Promise<void>[] = [];
  try {
    await persist();
    workers = Array.from(
      { length: Math.min(connectionCount, jobs.length) },
      () => worker()
    );
    try {
      await Promise.all(workers);
    } catch (error) {
      abort();
      await Promise.allSettled(workers);
      throw error;
    }
    return missingRanges(state).length === 0;
  } finally {
    try {
      await persist();
    } finally {
      await file.close();
      if (!firstUsed) await firstResponse.body?.cancel().catch(() => undefined);
    }
    if (missingRanges(state).length === 0) removeRangeState(filePath);
  }
}
