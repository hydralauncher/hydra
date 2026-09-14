import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getBitmapColorRange,
  isMostlyBlackScreenshot,
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

  it("rejects a black bitmap with a sparse bright outlier", () => {
    const pixels = new Uint8Array(100 * 4);
    for (let index = 3; index < pixels.length; index += 4) {
      pixels[index] = 255;
    }
    pixels.set([255, 255, 255, 255], 0);

    assert.equal(isNearlyUniformScreenshot(getBitmapColorRange(pixels)), false);
    assert.equal(isMostlyBlackScreenshot(pixels), true);
  });

  it("accepts a dark bitmap containing visible detail", () => {
    const pixels = new Uint8Array(100 * 4);
    for (let index = 3; index < pixels.length; index += 4) {
      pixels[index] = 255;
    }
    for (let pixel = 0; pixel < 5; pixel += 1) {
      pixels.set([80, 80, 80, 255], pixel * 4);
    }

    assert.equal(isMostlyBlackScreenshot(pixels), false);
  });
});
