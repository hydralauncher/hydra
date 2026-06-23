import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyRetryOutcome,
  isRetryableDownloadError,
  resolveResumeFilename,
  shouldResetRetryBudget,
  shouldRestartFromIgnoredRange,
} from "./js-http-downloader-helpers.ts";

describe("isRetryableDownloadError", () => {
  it("treats undici 'terminated' socket drops as retryable", () => {
    assert.equal(isRetryableDownloadError(new TypeError("terminated")), true);
  });

  it("retries on known network error codes", () => {
    const err = Object.assign(new Error("read failed"), {
      code: "ECONNRESET",
    });
    assert.equal(isRetryableDownloadError(err), true);
  });

  it("retries when the retryable code is nested in error.cause", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("socket hang up"), {
        code: "UND_ERR_SOCKET",
      }),
    });
    assert.equal(isRetryableDownloadError(err), true);
  });

  it("does not retry on application-level failures", () => {
    assert.equal(
      isRetryableDownloadError(
        new Error("The download link is not available (HTTP 404).")
      ),
      false
    );
    assert.equal(isRetryableDownloadError(new Error("boom")), false);
  });

  it("only matches the exact undici 'terminated' message, not substrings", () => {
    assert.equal(
      isRetryableDownloadError(new Error("Session terminated by user")),
      false
    );
    assert.equal(
      isRetryableDownloadError(new Error("Process terminated")),
      false
    );
  });
});

describe("resolveResumeFilename", () => {
  it("prefers the server-confirmed filename so a partial file is recognized on retry", () => {
    const result = resolveResumeFilename({
      knownFilename: "Resident-Evil-4.rar",
      optionFilename: undefined,
      url: "https://trashbytes.net/dl/sometoken",
    });
    assert.deepEqual(result, {
      filename: "Resident-Evil-4.rar",
      usedFallback: false,
    });
  });

  it("falls back to the option filename when nothing is confirmed yet", () => {
    const result = resolveResumeFilename({
      knownFilename: null,
      optionFilename: "game.bin",
      url: "https://example.com/dl/sometoken",
    });
    assert.equal(result.filename, "game.bin");
    assert.equal(result.usedFallback, false);
  });

  it("derives the filename from the URL when available", () => {
    const result = resolveResumeFilename({
      knownFilename: null,
      optionFilename: undefined,
      url: "https://example.com/files/setup.exe",
    });
    assert.equal(result.filename, "setup.exe");
    assert.equal(result.usedFallback, false);
  });

  it("flags the fallback name for tokenized CDN URLs with no derivable filename", () => {
    const result = resolveResumeFilename({
      knownFilename: null,
      optionFilename: undefined,
      url: "https://trashbytes.net/dl/sometoken",
    });
    assert.deepEqual(result, { filename: "download", usedFallback: true });
  });
});

describe("shouldRestartFromIgnoredRange", () => {
  it("restarts when a resumed request is answered with a full 200 body", () => {
    assert.equal(shouldRestartFromIgnoredRange(1024, 200), true);
  });

  it("keeps appending when the server honors the range with 206", () => {
    assert.equal(shouldRestartFromIgnoredRange(1024, 206), false);
  });

  it("does nothing for a fresh download starting at byte 0", () => {
    assert.equal(shouldRestartFromIgnoredRange(0, 200), false);
  });
});

describe("shouldResetRetryBudget", () => {
  const threshold = 4 * 1024 * 1024;

  it("resets once enough fresh data has flowed after a retry", () => {
    assert.equal(shouldResetRetryBudget(3, threshold, 0, threshold), true);
  });

  it("does not reset before the progress threshold is crossed", () => {
    assert.equal(shouldResetRetryBudget(3, 1024, 0, threshold), false);
  });

  it("never resets when no retry is in flight", () => {
    assert.equal(
      shouldResetRetryBudget(0, threshold * 10, 0, threshold),
      false
    );
  });
});

describe("classifyRetryOutcome", () => {
  const base = {
    isPaused: false,
    wasStallRetry: false,
    isAbortError: false,
    isRetryable: false,
    canRetry: true,
  };

  it("retries a retryable error within budget", () => {
    assert.equal(classifyRetryOutcome({ ...base, isRetryable: true }), "retry");
  });

  it("errors (not silently pauses) when a stall exhausts the retry budget", () => {
    assert.equal(
      classifyRetryOutcome({
        ...base,
        wasStallRetry: true,
        isRetryable: true,
        canRetry: false,
      }),
      "error-exhausted"
    );
  });

  it("pauses on a user-initiated abort", () => {
    assert.equal(
      classifyRetryOutcome({ ...base, isPaused: true, isAbortError: true }),
      "paused"
    );
  });

  it("pauses when the user pauses during a stall retry", () => {
    assert.equal(
      classifyRetryOutcome({
        ...base,
        isPaused: true,
        wasStallRetry: true,
        isRetryable: true,
      }),
      "paused"
    );
  });

  it("errors on a non-retryable failure", () => {
    assert.equal(classifyRetryOutcome(base), "error");
  });
});
