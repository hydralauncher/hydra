import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AxiosError } from "axios";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  isCloudSaveCommitTransportFailure,
  shouldReprepareCloudSaveSnapshot,
  shouldRetryCloudSaveConflict,
  shouldRetryCloudSaveStateChange,
} from "./snapshot-retry-policy.ts";

const axiosError = (status: number, data: unknown = null) => ({
  isAxiosError: true,
  response: { status, data },
});

const realAxiosError = (status?: number) => {
  const error = new AxiosError(
    status ? `Request failed with status code ${status}` : "socket hang up",
    status ? "ERR_BAD_RESPONSE" : "ECONNRESET"
  );

  if (status) {
    error.response = {
      status,
      statusText: "error",
      headers: {},
      config: { headers: {} },
      data: null,
    } as never;
  }

  return error;
};

describe("Cloud Save snapshot retry policy", () => {
  it("retries the same commit only for a transport failure", () => {
    assert.equal(
      isCloudSaveCommitTransportFailure(
        new Error("Request failed with ETIMEDOUT timeout")
      ),
      true
    );
    assert.equal(isCloudSaveCommitTransportFailure(axiosError(429)), false);
    assert.equal(isCloudSaveCommitTransportFailure(axiosError(401)), false);
    for (const status of [401, 409, 429, 500]) {
      assert.equal(
        isCloudSaveCommitTransportFailure(realAxiosError(status)),
        false
      );
    }
    assert.equal(isCloudSaveCommitTransportFailure(realAxiosError()), true);
  });

  it("reprepares only expired URLs or expired/incomplete pending snapshots", () => {
    assert.equal(
      shouldReprepareCloudSaveSnapshot(
        new Error("cloud_save_upload_url_expired")
      ),
      true
    );
    assert.equal(
      shouldReprepareCloudSaveSnapshot(
        axiosError(400, {
          message: "game/cloud-save-pending-snapshot-incomplete",
        })
      ),
      true
    );
    assert.equal(
      shouldReprepareCloudSaveSnapshot(axiosError(400, { message: "invalid" })),
      false
    );
    assert.equal(shouldReprepareCloudSaveSnapshot(axiosError(429)), false);
  });

  it("recalculates the full flow once for 409 and never for 429", () => {
    assert.equal(shouldRetryCloudSaveConflict(realAxiosError(409), 0), true);
    assert.equal(shouldRetryCloudSaveConflict(realAxiosError(409), 1), false);
    assert.equal(shouldRetryCloudSaveConflict(realAxiosError(429), 0), false);
  });

  it("allows only one retry after the analyzed state changes", () => {
    assert.equal(shouldRetryCloudSaveStateChange(0), true);
    assert.equal(shouldRetryCloudSaveStateChange(1), false);
  });
});
