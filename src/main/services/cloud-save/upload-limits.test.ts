import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertCloudSaveUploadWithinLimits,
  MAX_CLOUD_SAVE_SNAPSHOT_FILE_COUNT,
  MAX_CLOUD_SAVE_SNAPSHOT_SIZE_BYTES,
} from "./upload-limits.ts";

describe("Cloud Save upload limits", () => {
  it("accepts a proposal exactly at both limits", () => {
    const files = Array.from(
      { length: MAX_CLOUD_SAVE_SNAPSHOT_FILE_COUNT },
      (_, index) => ({
        sizeBytes: index === 0 ? MAX_CLOUD_SAVE_SNAPSHOT_SIZE_BYTES : 0,
      })
    );

    assert.doesNotThrow(() => assertCloudSaveUploadWithinLimits(files));
  });

  it("rejects a proposal above the total size limit", () => {
    assert.throws(
      () =>
        assertCloudSaveUploadWithinLimits([
          { sizeBytes: MAX_CLOUD_SAVE_SNAPSHOT_SIZE_BYTES },
          { sizeBytes: 1 },
        ]),
      /cloud_save_snapshot_too_large/
    );
  });

  it("rejects a proposal above the file count limit", () => {
    assert.throws(
      () =>
        assertCloudSaveUploadWithinLimits(
          Array.from(
            { length: MAX_CLOUD_SAVE_SNAPSHOT_FILE_COUNT + 1 },
            () => ({ sizeBytes: 0 })
          )
        ),
      /cloud_save_too_many_files/
    );
  });
});
