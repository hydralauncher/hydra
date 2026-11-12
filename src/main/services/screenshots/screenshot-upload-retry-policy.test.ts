import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getScreenshotModerationWaitDelay,
  getScreenshotUploadFailure,
  getScreenshotUploadRetryDelay,
  planScreenshotUploadRecovery,
  SCREENSHOT_MISSING_FILE_CODE,
  SCREENSHOT_MODERATION_DEFAULT_WAIT_MS,
  SCREENSHOT_MODERATION_MAX_WAIT_MS,
  SCREENSHOT_UPLOAD_CAPACITY_WAIT_DELAY_MS,
  SCREENSHOT_UPLOAD_GAME_WAIT_DELAY_MS,
  SCREENSHOT_UPLOAD_MAX_ATTEMPTS,
  SCREENSHOT_UPLOAD_MAX_GAME_WAITS,
  SCREENSHOT_UPLOAD_MAX_SERVER_WAITS,
  SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS,
  type ScreenshotUploadFailure,
  type ScreenshotUploadRetryState,
} from "./screenshot-upload-retry-policy.js";

const axiosError = (
  status: number,
  message?: string,
  headers: Record<string, string> = {}
) => ({
  isAxiosError: true,
  response: { status, data: message ? { message } : {}, headers },
});

const systemError = (code: string) =>
  Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;

const freshState: ScreenshotUploadRetryState = {
  uploadAttempts: 1,
  gameWaits: 0,
  moderationWaits: 0,
  capacityWaits: 0,
  rateLimitWaits: 0,
};

const plan = (
  failure: ScreenshotUploadFailure,
  state: Partial<ScreenshotUploadRetryState> = {},
  quality: "STANDARD" | "CLOUD" = "STANDARD"
) =>
  planScreenshotUploadRecovery(failure, { ...freshState, ...state }, quality);

describe("screenshot upload failure", () => {
  it("maps API error codes to recovery actions", () => {
    const cases: [string, ScreenshotUploadFailure["action"]][] = [
      ["game/not-found", "wait_for_game"],
      ["screenshots/already-uploaded", "already_uploaded"],
      ["screenshots/exceeds-tier-limit", "recompress_standard"],
      ["screenshots/cloud-subscription-required", "recompress_standard"],
      ["screenshots/client-id-conflict", "rotate_client_id"],
      ["screenshots/upload-expired", "rotate_client_id"],
      ["screenshots/upload-incomplete", "rotate_client_id"],
      ["screenshots/upload-mismatch", "rotate_client_id"],
      ["screenshots/upload-rate-limited", "rate_limit_wait"],
      ["screenshots/upload-capacity-reached", "wait"],
      ["screenshots/moderation-in-progress", "moderation_wait"],
      ["screenshots/limit-reached", "terminal"],
      ["feature/feature-not-enabled", "terminal"],
      ["user not logged in", "stop"],
    ];

    for (const [code, action] of cases) {
      assert.deepEqual(getScreenshotUploadFailure(axiosError(400, code)), {
        code,
        action,
      });
    }
  });

  it("treats a missing file as terminal", () => {
    assert.deepEqual(getScreenshotUploadFailure(systemError("ENOENT")), {
      code: SCREENSHOT_MISSING_FILE_CODE,
      action: "terminal",
    });
  });

  it("retries network failures and unknown server errors", () => {
    assert.equal(
      getScreenshotUploadFailure(systemError("ECONNRESET")).action,
      "retry"
    );
    assert.deepEqual(getScreenshotUploadFailure(axiosError(503)), {
      code: "http_503",
      action: "retry",
    });
  });

  it("stops on unmapped client rejections", () => {
    assert.equal(
      getScreenshotUploadFailure(axiosError(422, "screenshots/unknown")).action,
      "terminal"
    );
  });

  it("reads retry-after for retries, rate limits and moderation waits", () => {
    for (const code of [
      "screenshots/upload-rate-limited",
      "screenshots/moderation-rate-limited",
    ]) {
      assert.equal(
        getScreenshotUploadFailure(
          axiosError(429, code, { "retry-after": "12" })
        ).retryAfterMs,
        12_000
      );
    }
    assert.equal(
      getScreenshotUploadFailure(
        axiosError(503, undefined, { "retry-after": "12" })
      ).retryAfterMs,
      12_000
    );
  });

  it("ignores retry-after for other actions and invalid values", () => {
    assert.equal(
      getScreenshotUploadFailure(
        axiosError(503, "screenshots/upload-capacity-reached", {
          "retry-after": "12",
        })
      ).retryAfterMs,
      undefined
    );
    assert.equal(
      getScreenshotUploadFailure(
        axiosError(429, "screenshots/upload-rate-limited", {
          "retry-after": "soon",
        })
      ).retryAfterMs,
      undefined
    );
  });
});

describe("screenshot upload recovery plan", () => {
  it("backs off retries and counts them as attempts", () => {
    assert.deepEqual(plan({ code: "http_503", action: "retry" }), {
      kind: "retry_at",
      delay: getScreenshotUploadRetryDelay(1),
      countsAsAttempt: true,
    });
    assert.equal(getScreenshotUploadRetryDelay(1), 5_000);
    assert.equal(getScreenshotUploadRetryDelay(3), 20_000);
    assert.equal(
      getScreenshotUploadRetryDelay(50),
      SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS
    );
  });

  it("follows retry-after for retries up to the cap", () => {
    const failure = { code: "http_503", action: "retry" as const };
    assert.deepEqual(plan({ ...failure, retryAfterMs: 42_000 }), {
      kind: "retry_at",
      delay: 42_000,
      countsAsAttempt: true,
    });
    assert.deepEqual(plan({ ...failure, retryAfterMs: 60 * 60_000 }), {
      kind: "retry_at",
      delay: SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS,
      countsAsAttempt: true,
    });
  });

  it("fails retries after the attempt limit", () => {
    assert.deepEqual(
      plan(
        { code: "http_503", action: "retry" },
        { uploadAttempts: SCREENSHOT_UPLOAD_MAX_ATTEMPTS }
      ),
      { kind: "failed" }
    );
  });

  it("waits out rate limits without spending attempts", () => {
    const failure: ScreenshotUploadFailure = {
      code: "screenshots/upload-rate-limited",
      action: "rate_limit_wait",
    };

    assert.deepEqual(
      plan(
        { ...failure, retryAfterMs: 30_000 },
        { uploadAttempts: SCREENSHOT_UPLOAD_MAX_ATTEMPTS }
      ),
      { kind: "retry_at", delay: 30_000, countsAsAttempt: false }
    );
    assert.deepEqual(plan({ ...failure, retryAfterMs: 60 * 60_000 }), {
      kind: "retry_at",
      delay: SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS,
      countsAsAttempt: false,
    });
  });

  it("backs off rate limits by their own count when retry-after is missing", () => {
    const failure: ScreenshotUploadFailure = {
      code: "screenshots/upload-rate-limited",
      action: "rate_limit_wait",
    };

    assert.deepEqual(plan(failure, { rateLimitWaits: 0 }), {
      kind: "retry_at",
      delay: getScreenshotUploadRetryDelay(1),
      countsAsAttempt: false,
    });
    assert.deepEqual(plan(failure, { rateLimitWaits: 3 }), {
      kind: "retry_at",
      delay: getScreenshotUploadRetryDelay(4),
      countsAsAttempt: false,
    });
  });

  it("fails rate limits after the server wait cap", () => {
    assert.deepEqual(
      plan(
        { code: "screenshots/upload-rate-limited", action: "rate_limit_wait" },
        { rateLimitWaits: SCREENSHOT_UPLOAD_MAX_SERVER_WAITS }
      ),
      { kind: "failed" }
    );
  });

  it("treats a record without a rate limit count as zero", () => {
    assert.equal(
      planScreenshotUploadRecovery(
        { code: "screenshots/upload-rate-limited", action: "rate_limit_wait" },
        { uploadAttempts: 1, gameWaits: 0 },
        "STANDARD"
      ).kind,
      "retry_at"
    );
  });

  it("waits for the game to sync up to its cap", () => {
    const failure: ScreenshotUploadFailure = {
      code: "game/not-found",
      action: "wait_for_game",
    };

    assert.deepEqual(plan(failure, { gameWaits: 0 }), {
      kind: "retry_at",
      delay: SCREENSHOT_UPLOAD_GAME_WAIT_DELAY_MS,
      countsAsAttempt: false,
    });
    assert.deepEqual(
      plan(failure, { gameWaits: SCREENSHOT_UPLOAD_MAX_GAME_WAITS }),
      { kind: "failed" }
    );
  });

  it("waits for upload capacity up to its cap", () => {
    const failure: ScreenshotUploadFailure = {
      code: "screenshots/upload-capacity-reached",
      action: "wait",
    };

    assert.deepEqual(plan(failure), {
      kind: "retry_at",
      delay: SCREENSHOT_UPLOAD_CAPACITY_WAIT_DELAY_MS,
      countsAsAttempt: false,
    });
    assert.deepEqual(
      plan(failure, { capacityWaits: SCREENSHOT_UPLOAD_MAX_SERVER_WAITS }),
      { kind: "failed" }
    );
  });

  it("backs off moderation waits on top of retry-after up to its cap", () => {
    const failure: ScreenshotUploadFailure = {
      code: "screenshots/moderation-in-progress",
      action: "moderation_wait",
    };

    assert.equal(
      getScreenshotModerationWaitDelay(failure, 0),
      SCREENSHOT_MODERATION_DEFAULT_WAIT_MS + 2_000
    );
    assert.equal(
      getScreenshotModerationWaitDelay({ ...failure, retryAfterMs: 5_000 }, 2),
      5_000 + 8_000
    );
    assert.equal(
      getScreenshotModerationWaitDelay(failure, 20),
      SCREENSHOT_MODERATION_DEFAULT_WAIT_MS + 60_000
    );
    assert.equal(
      getScreenshotModerationWaitDelay(
        { ...failure, retryAfterMs: 30 * 24 * 60 * 60_000 },
        0
      ),
      SCREENSHOT_MODERATION_MAX_WAIT_MS
    );
    assert.deepEqual(plan(failure, { moderationWaits: 1 }), {
      kind: "retry_at",
      delay: getScreenshotModerationWaitDelay(failure, 1),
      countsAsAttempt: false,
    });
    assert.deepEqual(
      plan(failure, { moderationWaits: SCREENSHOT_UPLOAD_MAX_SERVER_WAITS }),
      { kind: "failed" }
    );
  });

  it("recompresses cloud uploads to standard once", () => {
    const failure: ScreenshotUploadFailure = {
      code: "screenshots/exceeds-tier-limit",
      action: "recompress_standard",
    };

    assert.deepEqual(plan(failure, {}, "CLOUD"), {
      kind: "retry_now",
      quality: "STANDARD",
    });
    assert.deepEqual(plan(failure, {}, "STANDARD"), { kind: "failed" });
  });

  it("rotates the client id with a backoff until the attempt limit", () => {
    const failure: ScreenshotUploadFailure = {
      code: "screenshots/upload-mismatch",
      action: "rotate_client_id",
    };

    assert.deepEqual(plan(failure), {
      kind: "retry_at",
      delay: getScreenshotUploadRetryDelay(1),
      countsAsAttempt: true,
      rotateClientId: true,
    });
    assert.deepEqual(plan(failure, { uploadAttempts: 4 }), {
      kind: "retry_at",
      delay: getScreenshotUploadRetryDelay(4),
      countsAsAttempt: true,
      rotateClientId: true,
    });
    assert.deepEqual(
      plan(failure, { uploadAttempts: SCREENSHOT_UPLOAD_MAX_ATTEMPTS }),
      { kind: "failed" }
    );
  });

  it("stops, fails or retries immediately for the remaining actions", () => {
    assert.deepEqual(plan({ code: "x", action: "stop" }), { kind: "stopped" });
    assert.deepEqual(plan({ code: "x", action: "terminal" }), {
      kind: "failed",
    });
    assert.deepEqual(plan({ code: "x", action: "already_uploaded" }), {
      kind: "retry_now",
    });
  });
});
