import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getGroupedSouvenirErrorCode,
  getGroupedSouvenirFailure,
  isMissingGroupedSouvenirScreenshot,
  isTerminalGroupedSouvenirError,
  SOUVENIR_LIMIT_ERROR_CODE,
} from "./grouped-souvenir-retry-policy.js";

const axiosError = (status: number, data: Record<string, unknown> = {}) => ({
  isAxiosError: true,
  response: { status, data },
});

const souvenirConflict = (reason: string) =>
  axiosError(409, {
    message: "achievements/souvenir-conflict",
    clientId: "client-1",
    reason,
  });

describe("grouped souvenir retry policy", () => {
  it("maps synchronization conflicts to their recovery actions", () => {
    const expectations = {
      reservation_not_found: "reauthorize_same_id",
      reservation_mismatch: "reauthorize_same_id",
      image_key_in_use: "rotate_id_and_reupload",
      achievement_not_found: "rebuild",
      achievement_already_assigned: "abandon",
      souvenir_payload_mismatch: "rotate_id_and_reupload",
      concurrent_update: "retry",
    } as const;

    for (const [reason, action] of Object.entries(expectations)) {
      assert.deepEqual(
        getGroupedSouvenirFailure(
          souvenirConflict(reason),
          "client-1",
          "synchronization"
        ),
        { code: reason, action }
      );
    }
  });

  it("rotates the client ID when authorization rejects a reservation", () => {
    assert.deepEqual(
      getGroupedSouvenirFailure(
        souvenirConflict("reservation_mismatch"),
        "client-1",
        "authorization"
      ),
      {
        code: "reservation_mismatch",
        action: "rotate_id_and_reupload",
      }
    );
  });

  it("recognizes a direct reservation mismatch from authorization", () => {
    assert.deepEqual(
      getGroupedSouvenirFailure(
        axiosError(409, {
          message: "reservation_mismatch",
          clientId: "client-1",
        }),
        "client-1",
        "authorization"
      ),
      {
        code: "reservation_mismatch",
        action: "rotate_id_and_reupload",
      }
    );
  });

  it("maps upload lifecycle errors to their recovery actions", () => {
    const expectations = {
      "achievements/souvenir-upload-deleted": "rotate_id_and_reupload",
      "achievements/souvenir-upload-expired": "reauthorize_same_id",
      "achievements/souvenir-upload-length-mismatch": "rotate_id_and_reupload",
      "achievements/souvenir-upload-incomplete": "retry",
    } as const;

    for (const [message, action] of Object.entries(expectations)) {
      assert.deepEqual(
        getGroupedSouvenirFailure(
          axiosError(message.endsWith("incomplete") ? 503 : 409, {
            message,
            clientId: "client-1",
          }),
          "client-1",
          "synchronization"
        ),
        { code: message, action }
      );
    }
  });

  it("abandons souvenirs when the collection limit is reached", () => {
    for (const stage of ["authorization", "synchronization"] as const) {
      assert.deepEqual(
        getGroupedSouvenirFailure(
          axiosError(400, { message: SOUVENIR_LIMIT_ERROR_CODE }),
          "client-1",
          stage
        ),
        { code: SOUVENIR_LIMIT_ERROR_CODE, action: "abandon" }
      );
    }
  });

  it("does not apply another client's failure to the pending souvenir", () => {
    assert.deepEqual(
      getGroupedSouvenirFailure(
        axiosError(409, {
          message: "achievements/souvenir-upload-deleted",
          clientId: "client-2",
        }),
        "client-1",
        "synchronization"
      ),
      {
        code: "achievements/souvenir-upload-deleted",
        action: "retry",
      }
    );
  });

  it("abandons unknown conflicts so achievements can sync separately", () => {
    const error = axiosError(409, {
      message: "achievements/souvenir-conflict",
      clientId: "client-1",
      reason: "future_conflict",
    });

    assert.equal(isTerminalGroupedSouvenirError(error, "client-1"), true);
    assert.deepEqual(
      getGroupedSouvenirFailure(error, "client-1", "synchronization"),
      { code: "future_conflict", action: "abandon" }
    );
  });

  it("identifies when the local screenshot no longer exists", () => {
    const error = Object.assign(new Error("Screenshot not found"), {
      code: "ENOENT",
    });

    assert.equal(isMissingGroupedSouvenirScreenshot(error), true);
    assert.equal(
      getGroupedSouvenirErrorCode(error),
      "souvenir_screenshot_missing"
    );
  });

  it("keeps request-level and transient failures retryable", () => {
    for (const status of [404, 422, 429, 503]) {
      assert.equal(
        getGroupedSouvenirFailure(
          axiosError(status),
          "client-1",
          "synchronization"
        ).action,
        "retry"
      );
    }
  });
});
