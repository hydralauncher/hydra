import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UMU_UPDATE_CHECK_INTERVAL_MS,
  UMU_UPDATE_RETRY_BASE_DELAY_MS,
  isUmuUpdateCheckDue,
  parseUmuUpdateState,
  recordUmuUpdateFailure,
  recordUmuUpdateSuccess,
} from "./umu-update-schedule.js";

const HOUR = 60 * 60 * 1000;

describe("umu update schedule", () => {
  it("checks once a day after a successful check", () => {
    const state = recordUmuUpdateSuccess("1.4.5", 0);
    assert.equal(isUmuUpdateCheckDue(null, 0), true);
    assert.equal(
      isUmuUpdateCheckDue(state, UMU_UPDATE_CHECK_INTERVAL_MS - 1),
      false
    );
    assert.equal(
      isUmuUpdateCheckDue(state, UMU_UPDATE_CHECK_INTERVAL_MS),
      true
    );
  });

  it("backs off after consecutive failures and keeps the installed version", () => {
    const succeeded = recordUmuUpdateSuccess("1.4.5", 0);
    const firstFailureAt = UMU_UPDATE_CHECK_INTERVAL_MS;
    const first = recordUmuUpdateFailure(succeeded, "1.4.5", firstFailureAt);

    assert.equal(first.version, "1.4.5");
    assert.equal(first.failureCount, 1);
    assert.equal(
      first.retryAt,
      firstFailureAt + UMU_UPDATE_RETRY_BASE_DELAY_MS
    );
    assert.equal(isUmuUpdateCheckDue(first, firstFailureAt + 1), false);
    assert.equal(isUmuUpdateCheckDue(first, firstFailureAt + HOUR - 1), false);

    const second = recordUmuUpdateFailure(first, "1.4.5", first.retryAt!);
    assert.equal(second.failureCount, 2);
    assert.equal(second.retryAt, first.retryAt! + 2 * HOUR);

    let state = second;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      state = recordUmuUpdateFailure(state, "1.4.5", state.retryAt!);
    }
    const attemptedAt = state.retryAt!;
    const capped = recordUmuUpdateFailure(state, "1.4.5", attemptedAt);
    assert.equal(capped.retryAt! - attemptedAt, UMU_UPDATE_CHECK_INTERVAL_MS);
  });

  it("recovers after the retry interval and resets the failure count", () => {
    const failed = recordUmuUpdateFailure(null, null, 1000);
    assert.equal(isUmuUpdateCheckDue(failed, failed.retryAt! - 1), false);
    assert.equal(isUmuUpdateCheckDue(failed, failed.retryAt!), true);

    const recovered = recordUmuUpdateSuccess(null, failed.retryAt!);
    assert.equal(recovered.failureCount, 0);
    assert.equal(recovered.retryAt, null);
    assert.equal(isUmuUpdateCheckDue(recovered, failed.retryAt! + HOUR), false);
  });

  it("reads persisted state defensively", () => {
    assert.equal(parseUmuUpdateState(null), null);
    assert.equal(parseUmuUpdateState({ version: "1.4.5" }), null);
    assert.deepEqual(
      parseUmuUpdateState({ version: "../evil", checkedAt: 5 }),
      { version: null, checkedAt: 5, failureCount: 0, retryAt: null }
    );
    assert.deepEqual(
      parseUmuUpdateState({
        version: "1.4.5",
        checkedAt: 5,
        failureCount: 2,
        retryAt: 10,
      }),
      { version: "1.4.5", checkedAt: 5, failureCount: 2, retryAt: 10 }
    );
  });
});
