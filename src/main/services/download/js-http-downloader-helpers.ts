export const PROGRESS_RESET_THRESHOLD_BYTES = 4 * 1024 * 1024;

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
]);

export function isRetryableDownloadError(err: Error): boolean {
  const nodeError = err as NodeJS.ErrnoException;

  if (nodeError.code && RETRYABLE_ERROR_CODES.has(nodeError.code)) {
    return true;
  }

  const cause = nodeError.cause as NodeJS.ErrnoException | undefined;
  if (cause?.code && RETRYABLE_ERROR_CODES.has(cause.code)) {
    return true;
  }

  const message = err.message.toLowerCase().trim();
  return (
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("connection") ||
    message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("fetch failed") ||
    message === "terminated"
  );
}

export function extractFilenameFromUrl(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/");
    const filename = pathParts.at(-1);

    if (filename?.includes(".") && filename.length > 0) {
      return decodeURIComponent(filename);
    }
  } catch {
    // Invalid URL
  }
  return undefined;
}

export function resolveResumeFilename(options: {
  knownFilename: string | null;
  optionFilename?: string;
  url: string;
}): { filename: string; usedFallback: boolean } {
  const extracted =
    options.knownFilename ||
    options.optionFilename ||
    extractFilenameFromUrl(options.url);

  return {
    filename: extracted || "download",
    usedFallback: !extracted,
  };
}

export function shouldRestartFromIgnoredRange(
  startByte: number,
  responseStatus: number
): boolean {
  return startByte > 0 && responseStatus === 200;
}

export function shouldResetRetryBudget(
  retryCount: number,
  bytesDownloaded: number,
  bytesAtAttemptStart: number,
  thresholdBytes: number
): boolean {
  return (
    retryCount > 0 && bytesDownloaded - bytesAtAttemptStart >= thresholdBytes
  );
}

export type RetryDecision = "retry" | "paused" | "error-exhausted" | "error";

export function classifyRetryOutcome(input: {
  isPaused: boolean;
  wasStallRetry: boolean;
  isAbortError: boolean;
  isRetryable: boolean;
  canRetry: boolean;
}): RetryDecision {
  if (input.isPaused && !input.wasStallRetry) return "paused";

  if (input.isRetryable && input.canRetry && !input.isPaused) return "retry";

  if (input.isPaused) return "paused";

  if (input.isRetryable && !input.canRetry) return "error-exhausted";

  if (input.isAbortError && !input.wasStallRetry) return "paused";

  return "error";
}
