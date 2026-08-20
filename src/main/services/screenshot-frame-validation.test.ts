import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getBitmapColorRange,
  isNearlyUniformScreenshot,
} from "./screenshot-frame-validation.js";

describe("screenshot frame validation", () => {
  it("rejects an all-white frame", () => {
    assert.equal(
      isNearlyUniformScreenshot({
        red: { min: 255, max: 255 },
        green: { min: 255, max: 255 },
        blue: { min: 255, max: 255 },
      }),
      true
    );
  });

  it("rejects a nearly uniform frame", () => {
    assert.equal(
      isNearlyUniformScreenshot({
        red: { min: 247, max: 255 },
        green: { min: 248, max: 255 },
        blue: { min: 249, max: 255 },
      }),
      true
    );
  });

  it("accepts a frame containing visible detail", () => {
    assert.equal(
      isNearlyUniformScreenshot({
        red: { min: 40, max: 210 },
        green: { min: 15, max: 190 },
        blue: { min: 25, max: 230 },
      }),
      false
    );
  });

  it("reads BGRA bitmap channels for emulator screenshot validation", () => {
    assert.deepEqual(
      getBitmapColorRange(
        Uint8Array.from([10, 20, 30, 255, 200, 150, 100, 255])
      ),
      {
        red: { min: 30, max: 100 },
        green: { min: 20, max: 150 },
        blue: { min: 10, max: 200 },
      }
    );
  });

  it("rejects an all-black emulator bitmap", () => {
    const pixels = Uint8Array.from([0, 0, 0, 255, 0, 0, 0, 255]);

    assert.equal(isNearlyUniformScreenshot(getBitmapColorRange(pixels)), true);
  });
});
