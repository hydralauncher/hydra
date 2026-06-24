import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySkip,
  clampProgress,
  computeFileSize,
  isRetryableDownloadError,
  isRetryableHttpStatus,
  MAX_BUDGET_RESETS,
  parseRetryAfterMs,
  PROGRESS_RESET_THRESHOLD_BYTES,
  resolveResumeAction,
  shouldResetRetryBudget,
  stallDetected,
} from "./js-http-downloader-helpers.ts";

describe("computeFileSize", () => {
  it("uses the total from a 206 content-range header", () => {
    assert.equal(
      computeFileSize({
        status: 206,
        contentRange: "bytes 100-199/500",
        contentLength: "400",
        startByte: 100,
      }),
      500
    );
  });

  it("treats a 200 on a resume as the FULL file size (no doubling)", () => {
    assert.equal(
      computeFileSize({
        status: 200,
        contentRange: null,
        contentLength: "500",
        startByte: 100,
      }),
      500
    );
  });

  it("adds startByte for a 206 without a content-range header", () => {
    assert.equal(
      computeFileSize({
        status: 206,
        contentRange: null,
        contentLength: "400",
        startByte: 100,
      }),
      500
    );
  });

  it("returns the content-length as-is for a first-pass 200", () => {
    assert.equal(
      computeFileSize({
        status: 200,
        contentRange: null,
        contentLength: "500",
        startByte: 0,
      }),
      500
    );
  });

  it("returns null when nothing is parseable", () => {
    assert.equal(
      computeFileSize({
        status: 200,
        contentRange: null,
        contentLength: null,
        startByte: 0,
      }),
      null
    );
  });
});

describe("resolveResumeAction", () => {
  it("writes a fresh file on a first request", () => {
    assert.deepEqual(
      resolveResumeAction({ startByte: 0, status: 200, partialStart: null }),
      { flags: "w", skipBytes: 0, restart: false, rangeIgnored: false }
    );
  });

  it("appends from the offset on a well-formed 206 resume", () => {
    assert.deepEqual(
      resolveResumeAction({ startByte: 100, status: 206, partialStart: 100 }),
      { flags: "a", skipBytes: 0, restart: false, rangeIgnored: false }
    );
  });

  it("skips the prefix when the server ignores Range (200 on resume)", () => {
    assert.deepEqual(
      resolveResumeAction({ startByte: 100, status: 200, partialStart: null }),
      { flags: "a", skipBytes: 100, restart: false, rangeIgnored: true }
    );
  });

  it("keeps skipping (never truncates) on a repeated Range-ignored 200", () => {
    assert.deepEqual(
      resolveResumeAction({ startByte: 5000, status: 200, partialStart: null }),
      { flags: "a", skipBytes: 5000, restart: false, rangeIgnored: true }
    );
  });

  it("skips the overlap when a 206 starts before the resume offset", () => {
    assert.deepEqual(
      resolveResumeAction({ startByte: 100, status: 206, partialStart: 40 }),
      { flags: "a", skipBytes: 60, restart: false, rangeIgnored: false }
    );
  });

  it("restarts when a 206 starts after the resume offset (would gap)", () => {
    assert.deepEqual(
      resolveResumeAction({ startByte: 100, status: 206, partialStart: 150 }),
      { flags: "w", skipBytes: 0, restart: true, rangeIgnored: false }
    );
  });
});

describe("applySkip", () => {
  it("writes the whole chunk when nothing is left to skip", () => {
    assert.deepEqual(applySkip(0, 60), {
      newRemainingToSkip: 0,
      writeOffset: 0,
      shouldWrite: true,
    });
  });

  it("drops a chunk fully inside the skip window", () => {
    assert.deepEqual(applySkip(100, 60), {
      newRemainingToSkip: 40,
      writeOffset: 0,
      shouldWrite: false,
    });
  });

  it("drops a chunk exactly equal to the remaining skip", () => {
    assert.deepEqual(applySkip(60, 60), {
      newRemainingToSkip: 0,
      writeOffset: 0,
      shouldWrite: false,
    });
  });

  it("writes only the tail of a chunk that straddles the boundary", () => {
    assert.deepEqual(applySkip(40, 60), {
      newRemainingToSkip: 0,
      writeOffset: 40,
      shouldWrite: true,
    });
  });

  it("reconstructs an exact tail across a 60+60+60 skip of 100", () => {
    let remaining = 100;
    const written: number[] = [];
    for (const len of [60, 60, 60]) {
      const plan = applySkip(remaining, len);
      remaining = plan.newRemainingToSkip;
      if (plan.shouldWrite) written.push(len - plan.writeOffset);
    }
    assert.deepEqual(written, [20, 60]);
    assert.equal(
      written.reduce((a, b) => a + b, 0),
      80
    );
  });
});

describe("isRetryableDownloadError", () => {
  it("treats undici 'terminated' as retryable", () => {
    assert.equal(isRetryableDownloadError(new TypeError("terminated")), true);
  });

  it("inspects err.cause.code", () => {
    const err = new TypeError("terminated");
    (err as { cause?: unknown }).cause = { code: "UND_ERR_SOCKET" };
    assert.equal(isRetryableDownloadError(err), true);
  });

  it("matches any UND_ERR_* cause code via prefix", () => {
    const err = new Error("fetch failed");
    (err as { cause?: unknown }).cause = { code: "UND_ERR_SOMETHING_NEW" };
    assert.equal(isRetryableDownloadError(err), true);
  });

  it("matches top-level node codes", () => {
    const err = new Error("read ECONNRESET");
    (err as { code?: string }).code = "ECONNRESET";
    assert.equal(isRetryableDownloadError(err), true);
  });

  it("does not throw and returns false for a string cause", () => {
    const err = new Error("nope");
    (err as { cause?: unknown }).cause = "some string";
    assert.equal(isRetryableDownloadError(err), false);
  });

  it("treats a dead-link HTTP error as non-retryable", () => {
    assert.equal(
      isRetryableDownloadError(
        new Error("The download link is not available (HTTP 404).")
      ),
      false
    );
  });

  it("returns false for non-Error values", () => {
    assert.equal(isRetryableDownloadError("terminated"), false);
  });

  it("honors an explicit retryable flag (transient HTTP status)", () => {
    const err = Object.assign(new Error("HTTP 429"), { retryable: true });
    assert.equal(isRetryableDownloadError(err), true);
  });

  it("treats a non-retryable status error as fatal", () => {
    const err = Object.assign(new Error("HTTP 403"), { retryable: false });
    assert.equal(isRetryableDownloadError(err), false);
  });

  it("an explicit retryable:false overrides matching message fragments", () => {
    const err = Object.assign(new Error("connection reset by peer"), {
      retryable: false,
    });
    assert.equal(isRetryableDownloadError(err), false);
  });
});

describe("isRetryableHttpStatus", () => {
  it("retries rate limits and gateway errors", () => {
    for (const s of [408, 429, 500, 502, 503, 504]) {
      assert.equal(isRetryableHttpStatus(s), true, `status ${s}`);
    }
  });

  it("does not retry permanent client errors", () => {
    for (const s of [400, 401, 403, 404, 410]) {
      assert.equal(isRetryableHttpStatus(s), false, `status ${s}`);
    }
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    assert.equal(parseRetryAfterMs("5", 1_000_000), 5000);
    assert.equal(parseRetryAfterMs("0", 1_000_000), 0);
  });

  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    assert.equal(
      parseRetryAfterMs("Thu, 01 Jan 2026 00:00:30 GMT", now),
      30000
    );
  });

  it("never returns a negative wait for a past date", () => {
    const now = Date.parse("2026-01-01T00:01:00Z");
    assert.equal(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:00 GMT", now), 0);
  });

  it("returns null for missing or unparseable values", () => {
    assert.equal(parseRetryAfterMs(null, 1_000_000), null);
    assert.equal(parseRetryAfterMs("", 1_000_000), null);
    assert.equal(parseRetryAfterMs("soon", 1_000_000), null);
  });
});

describe("shouldResetRetryBudget", () => {
  it("resets once enough new data has flowed this attempt", () => {
    assert.equal(
      shouldResetRetryBudget(
        PROGRESS_RESET_THRESHOLD_BYTES,
        0,
        PROGRESS_RESET_THRESHOLD_BYTES,
        MAX_BUDGET_RESETS
      ),
      true
    );
  });

  it("does not reset below the threshold", () => {
    assert.equal(
      shouldResetRetryBudget(
        PROGRESS_RESET_THRESHOLD_BYTES - 1,
        0,
        PROGRESS_RESET_THRESHOLD_BYTES,
        MAX_BUDGET_RESETS
      ),
      false
    );
  });

  it("stops resetting once the absolute cap is reached", () => {
    assert.equal(
      shouldResetRetryBudget(
        PROGRESS_RESET_THRESHOLD_BYTES * 10,
        MAX_BUDGET_RESETS,
        PROGRESS_RESET_THRESHOLD_BYTES,
        MAX_BUDGET_RESETS
      ),
      false
    );
  });

  it("never resets on a negative delta (post-restart counter)", () => {
    assert.equal(
      shouldResetRetryBudget(
        -1000,
        0,
        PROGRESS_RESET_THRESHOLD_BYTES,
        MAX_BUDGET_RESETS
      ),
      false
    );
  });
});

describe("stallDetected", () => {
  it("is false when no read is in flight", () => {
    assert.equal(stallDetected(null, 1_000_000, 30000), false);
  });

  it("is false while a read is in flight but under the timeout", () => {
    assert.equal(stallDetected(1_000_000, 1_020_000, 30000), false);
  });

  it("is true once a read has been blocked past the timeout", () => {
    assert.equal(stallDetected(1_000_000, 1_031_000, 30000), true);
  });
});

describe("clampProgress", () => {
  it("clamps above 1", () => {
    assert.equal(clampProgress(1.5), 1);
  });

  it("clamps below 0", () => {
    assert.equal(clampProgress(-0.2), 0);
  });

  it("returns 0 for non-finite values", () => {
    assert.equal(clampProgress(Number.NaN), 0);
  });
});
