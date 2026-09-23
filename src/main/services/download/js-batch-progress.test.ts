import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getJsBatchProgress } from "./js-batch-progress.ts";

describe("JS batch progress", () => {
  it("does not count a finished file again while preparing the next one", () => {
    assert.deepEqual(
      getJsBatchProgress({
        currentIndex: 1,
        activeIndex: 0,
        completedBytes: 100,
        totalBytes: 200,
        entryCount: 2,
        fileBytes: 100,
        fileProgress: 1,
      }),
      { currentBytes: 0, progress: 0.5 }
    );
  });

  it("keeps the last file below 100% until completion is recorded", () => {
    assert.deepEqual(
      getJsBatchProgress({
        currentIndex: 1,
        activeIndex: 1,
        completedBytes: 100,
        totalBytes: 200,
        entryCount: 2,
        fileBytes: 100,
        fileProgress: 1,
      }),
      { currentBytes: 100, progress: 0.9999 }
    );
  });
});
