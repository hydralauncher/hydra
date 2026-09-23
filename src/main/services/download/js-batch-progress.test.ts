import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getJsBatchProgress, sampleJsBatchSpeed } from "./js-batch-progress.ts";

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

describe("JS batch speed", () => {
  it("does not count a resumed file's saved bytes as network speed", () => {
    const resumed = sampleJsBatchSpeed(
      {
        lastSpeedUpdate: 0,
        bytesAtLastSpeedUpdate: null,
        batchSpeed: 0,
      },
      2_000_000_000,
      40_000_000,
      1_500
    );

    assert.deepEqual(resumed, {
      lastSpeedUpdate: 1_500,
      bytesAtLastSpeedUpdate: 2_000_000_000,
      batchSpeed: 40_000_000,
    });
    assert.equal(
      sampleJsBatchSpeed(resumed, 2_050_000_000, 50_000_000, 2_500).batchSpeed,
      50_000_000
    );
  });

  it("resets the speed baseline when durable progress moves backward", () => {
    const reset = sampleJsBatchSpeed(
      {
        lastSpeedUpdate: 1_000,
        bytesAtLastSpeedUpdate: 500_000_000,
        batchSpeed: 80_000_000,
      },
      450_000_000,
      0,
      2_000
    );

    assert.deepEqual(reset, {
      lastSpeedUpdate: 2_000,
      bytesAtLastSpeedUpdate: 450_000_000,
      batchSpeed: 0,
    });
  });
});
