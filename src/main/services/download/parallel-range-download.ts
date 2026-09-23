import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

export const PARALLEL_RANGE_SIZE = 8 * 1024 * 1024;
export const PARALLEL_RANGE_COUNT = 4;

export class ParallelRangeUnsupportedError extends Error {
  readonly retryable = true;
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

export interface ParallelRangeDownloadOptions {
  url: string;
  headers: Record<string, string>;
  firstResponse: Response;
  filePath: string;
  startByte: number;
  total: number;
  signal: AbortSignal;
  abort: () => void;
  beforeChunk: (length: number) => Promise<void>;
  afterChunk: (length: number) => void;
  onReadPending: (offset: number, pending: boolean) => void;
}

export async function downloadParallelRanges({
  url,
  headers,
  firstResponse,
  filePath,
  startByte,
  total,
  signal,
  abort,
  beforeChunk,
  afterChunk,
  onReadPending,
}: ParallelRangeDownloadOptions): Promise<void> {
  let tempDir: string;
  try {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-ranges-")
    );
  } catch (error) {
    await firstResponse.body?.cancel().catch(() => undefined);
    throw error;
  }
  const validator = firstResponse.headers.get("etag")?.startsWith("W/")
    ? firstResponse.headers.get("last-modified")
    : (firstResponse.headers.get("etag") ??
      firstResponse.headers.get("last-modified"));

  const downloadRange = async (
    start: number,
    end: number,
    tempFile: string,
    response?: Response
  ): Promise<void> => {
    if (signal.aborted) throw signal.reason;

    let rangeResponse = response;
    if (!rangeResponse) {
      onReadPending(start, true);
      try {
        rangeResponse = await fetch(url, {
          headers: {
            ...headers,
            Range: `bytes=${start}-${end}`,
            ...(validator ? { "If-Range": validator } : {}),
          },
          signal,
        });
      } finally {
        onReadPending(start, false);
      }
    }

    const responseValidator = validator?.startsWith('"')
      ? rangeResponse.headers.get("etag")
      : rangeResponse.headers.get("last-modified");
    if (
      getRangeTotal(rangeResponse, start, end) !== total ||
      (validator && responseValidator && responseValidator !== validator)
    ) {
      await rangeResponse.body?.cancel();
      throw new ParallelRangeUnsupportedError(
        "The download server stopped serving matching byte ranges"
      );
    }
    if (!rangeResponse.body) {
      throw new Error("Range response body is null");
    }

    const reader = rangeResponse.body.getReader();
    let file: fs.promises.FileHandle;
    try {
      file = await fs.promises.open(tempFile, "w");
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
      throw error;
    }
    let received = 0;
    let done = false;
    try {
      for (;;) {
        onReadPending(start, true);
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await reader.read();
        } finally {
          onReadPending(start, false);
        }
        if (result.done) {
          done = true;
          break;
        }

        const chunk = result.value;
        if (received + chunk.length > end - start + 1) {
          throw new ParallelRangeUnsupportedError(
            "The download server sent more data than the requested byte range"
          );
        }
        await beforeChunk(chunk.length);
        if (signal.aborted) throw signal.reason;
        let written = 0;
        while (written < chunk.length) {
          const result = await file.write(
            chunk,
            written,
            chunk.length - written
          );
          if (result.bytesWritten === 0) {
            throw new Error("Could not write the downloaded byte range");
          }
          written += result.bytesWritten;
        }
        received += chunk.length;
        afterChunk(chunk.length);
      }
    } finally {
      try {
        await file.close();
      } finally {
        if (!done) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }

    if (received !== end - start + 1) {
      const error = new Error(
        `Byte range ended early (received ${received}, expected ${end - start + 1})`
      ) as Error & { retryable: boolean };
      error.retryable = true;
      throw error;
    }
  };

  try {
    for (let batchStart = startByte; batchStart < total; ) {
      const ranges: { start: number; end: number; tempFile: string }[] = [];
      for (
        let index = 0;
        index < PARALLEL_RANGE_COUNT && batchStart < total;
        index++
      ) {
        const end = Math.min(batchStart + PARALLEL_RANGE_SIZE - 1, total - 1);
        ranges.push({
          start: batchStart,
          end,
          tempFile: path.join(tempDir, String(index)),
        });
        batchStart = end + 1;
      }

      const transfers = ranges.map((range, index) =>
        downloadRange(
          range.start,
          range.end,
          range.tempFile,
          index === 0 && range.start === startByte ? firstResponse : undefined
        )
      );
      try {
        await Promise.all(transfers);
      } catch (error) {
        // A failed range makes the whole batch unusable. Stop its peers before
        // removing their temporary files or retrying from the committed prefix.
        if (!signal.aborted) abort();
        await Promise.allSettled(transfers);
        throw error;
      }

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
  } finally {
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => undefined);
  }
}
