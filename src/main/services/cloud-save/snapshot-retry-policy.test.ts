import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  isCloudSaveCommitTransportFailure,
  shouldReprepareCloudSaveSnapshot,
  shouldRetryCloudSaveConflict,
} from "./snapshot-retry-policy.ts";

const axiosError = (status: number, data: unknown = null) => ({
  isAxiosError: true,
  response: { status, data },
});

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
    assert.equal(shouldRetryCloudSaveConflict(axiosError(409), 0), true);
    assert.equal(shouldRetryCloudSaveConflict(axiosError(409), 1), false);
    assert.equal(shouldRetryCloudSaveConflict(axiosError(429), 0), false);
  });
});
