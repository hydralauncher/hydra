export const PROGRESS_RESET_THRESHOLD_BYTES = 16 * 1024 * 1024;
export const MAX_BUDGET_RESETS = 50;
export const MAX_RESTARTS_FROM_ZERO = 3;

export const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EPIPE",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ESOCKETTIMEDOUT",
  "ERR_STREAM_PREMATURE_CLOSE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_REQ_RETRY",
]);

const RETRYABLE_MESSAGE_FRAGMENTS = [
  "network",
  "socket",
  "connection",
  "timeout",
  "aborted",
  "econnreset",
  "etimedout",
  "fetch failed",
];

// Transient HTTP statuses worth retrying with backoff (rate limits, gateway and
// upstream hiccups). Permanent 4xx (400/401/403/404/410) stay fatal so a dead
// link fails fast instead of looping.
export const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUS.has(status);
}

// Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
export function parseRetryAfterMs(
  headerValue: string | null,
  nowMs: number
): number | null {
  if (!headerValue) return null;

  const trimmed = headerValue.trim();
  if (trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - nowMs);
  }

  return null;
}

export function isRetryableDownloadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const retryableFlag = (err as { retryable?: unknown }).retryable;
  if (retryableFlag === true) return true;
  if (retryableFlag === false) return false;

  const nodeError = err as NodeJS.ErrnoException;
  if (nodeError.code && RETRYABLE_ERROR_CODES.has(nodeError.code)) {
    return true;
  }

  const cause = nodeError.cause;
  if (cause && typeof cause === "object") {
    const causeCode = (cause as NodeJS.ErrnoException).code;
    if (
      typeof causeCode === "string" &&
      (RETRYABLE_ERROR_CODES.has(causeCode) || causeCode.startsWith("UND_ERR_"))
    ) {
      return true;
    }
  }

  const message = err.message.toLowerCase().trim();
  if (message === "terminated") return true;

  return RETRYABLE_MESSAGE_FRAGMENTS.some((fragment) =>
    message.includes(fragment)
  );
}

export function computeFileSize(input: {
  status: number;
  contentRange: string | null;
  contentLength: string | null;
  startByte: number;
}): number | null {
  if (input.contentRange) {
    const match = /bytes \d+-\d+\/(\d+)/.exec(input.contentRange);
    if (match) {
      const total = Number.parseInt(match[1], 10);
      return Number.isFinite(total) ? total : null;
    }
    return null;
  }

  if (!input.contentLength) return null;

  const length = Number.parseInt(input.contentLength, 10);
  if (!Number.isFinite(length)) return null;

  return input.status === 206 ? input.startByte + length : length;
}

export interface ResumeAction {
  flags: "a" | "w";
  skipBytes: number;
  restart: boolean;
  rangeIgnored: boolean;
}

export function resolveResumeAction(input: {
  startByte: number;
  status: number;
  partialStart: number | null;
}): ResumeAction {
  if (input.startByte <= 0) {
    return { flags: "w", skipBytes: 0, restart: false, rangeIgnored: false };
  }

  // Server ignored the Range request and is resending the whole file. Keep the
  // partial and discard the prefix we already hold; this converges even on
  // hosts that never honor Range, without throwing away downloaded progress.
  if (input.status === 200) {
    return {
      flags: "a",
      skipBytes: input.startByte,
      restart: false,
      rangeIgnored: true,
    };
  }

  // Partial content: align to the server's actual Content-Range start.
  if (input.partialStart !== null) {
    if (input.partialStart > input.startByte) {
      // Server started ahead of our data; appending would leave a gap.
      return { flags: "w", skipBytes: 0, restart: true, rangeIgnored: false };
    }
    if (input.partialStart < input.startByte) {
      // Server resent bytes we already hold; discard the overlap.
      return {
        flags: "a",
        skipBytes: input.startByte - input.partialStart,
        restart: false,
        rangeIgnored: false,
      };
    }
  }

  return { flags: "a", skipBytes: 0, restart: false, rangeIgnored: false };
}

export function applySkip(
  remainingToSkip: number,
  chunkLength: number
): { newRemainingToSkip: number; writeOffset: number; shouldWrite: boolean } {
  if (remainingToSkip <= 0) {
    return { newRemainingToSkip: 0, writeOffset: 0, shouldWrite: true };
  }
  if (chunkLength <= remainingToSkip) {
    return {
      newRemainingToSkip: remainingToSkip - chunkLength,
      writeOffset: 0,
      shouldWrite: false,
    };
  }
  return {
    newRemainingToSkip: 0,
    writeOffset: remainingToSkip,
    shouldWrite: true,
  };
}

export function shouldResetRetryBudget(
  newBytesThisAttempt: number,
  budgetResets: number,
  thresholdBytes: number,
  maxResets: number
): boolean {
  return newBytesThisAttempt >= thresholdBytes && budgetResets < maxResets;
}

export function stallDetected(
  pendingReadSince: number | null,
  now: number,
  timeoutMs: number
): boolean {
  if (pendingReadSince === null) return false;
  return now - pendingReadSince > timeoutMs;
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(progress, 1));
}
