import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCloudSaveErrorDetails } from "./cloud-save-error-details.ts";

describe("cloud save error details", () => {
  it("propagates the restore metadata error code from a nested message", () => {
    assert.equal(
      getCloudSaveErrorDetails(
        new Error("Cloud save failed: cloud_save_restore_metadata_failed")
      ).errorCode,
      "cloud_save_restore_metadata_failed"
    );
  });

  it("prefers an explicit error code", () => {
    assert.equal(
      getCloudSaveErrorDetails({
        code: "explicit_code",
        message: "cloud_save_restore_metadata_failed",
      }).errorCode,
      "explicit_code"
    );
  });
});
