import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  encodeWithinByteCap,
  fitSizeInsideBox,
  getQualitySteps,
  isUndecodableImageError,
  MINIMUM_SCREENSHOT_QUALITY,
  SCREENSHOT_THUMBNAIL_BOX,
  SCREENSHOT_TIER_BOXES,
} from "./screenshot-compression-plan.js";

describe("screenshot compression plan", () => {
  it("keeps images that already fit", () => {
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 1280, height: 720 },
        SCREENSHOT_TIER_BOXES.STANDARD
      ),
      { width: 1280, height: 720 }
    );
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 800, height: 600 },
        SCREENSHOT_TIER_BOXES.CLOUD
      ),
      { width: 800, height: 600 }
    );
  });

  it("scales down to the tier box keeping the aspect ratio", () => {
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 3840, height: 2160 },
        SCREENSHOT_TIER_BOXES.STANDARD
      ),
      { width: 1280, height: 720 }
    );
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 3840, height: 2160 },
        SCREENSHOT_TIER_BOXES.CLOUD
      ),
      { width: 1920, height: 1080 }
    );
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 3440, height: 1440 },
        SCREENSHOT_TIER_BOXES.CLOUD
      ),
      { width: 1920, height: 804 }
    );
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 1080, height: 1920 },
        SCREENSHOT_TIER_BOXES.STANDARD
      ),
      { width: 405, height: 720 }
    );
  });

  it("limits thumbnails by width only", () => {
    assert.deepEqual(
      fitSizeInsideBox({ width: 1920, height: 1080 }, SCREENSHOT_THUMBNAIL_BOX),
      { width: 480, height: 270 }
    );
    assert.deepEqual(
      fitSizeInsideBox({ width: 400, height: 4000 }, SCREENSHOT_THUMBNAIL_BOX),
      { width: 400, height: 4000 }
    );
  });

  it("never rounds a side down to zero", () => {
    assert.deepEqual(
      fitSizeInsideBox(
        { width: 10000, height: 1 },
        SCREENSHOT_TIER_BOXES.STANDARD
      ),
      { width: 1280, height: 1 }
    );
  });

  it("rejects empty dimensions", () => {
    assert.throws(
      () =>
        fitSizeInsideBox(
          { width: 0, height: 720 },
          SCREENSHOT_TIER_BOXES.STANDARD
        ),
      RangeError
    );
  });

  it("steps quality down to the minimum", () => {
    assert.deepEqual(
      getQualitySteps(95),
      [95, 90, 85, 80, 75, 70, 65, 60, 55, 50]
    );
    assert.deepEqual(getQualitySteps(MINIMUM_SCREENSHOT_QUALITY), [50]);
    assert.deepEqual(getQualitySteps(40), []);
  });

  it("returns the first quality that fits the byte cap", async () => {
    const tried: number[] = [];
    const result = await encodeWithinByteCap(
      async (quality) => {
        tried.push(quality);
        return Buffer.alloc(quality * 10);
      },
      { maxBytes: 800, quality: 90 }
    );

    assert.deepEqual(tried, [90, 85, 80]);
    assert.equal(result.quality, 80);
    assert.equal(result.buffer.byteLength, 800);
  });

  it("fails when even the minimum quality is too large", async () => {
    await assert.rejects(
      encodeWithinByteCap(async () => Buffer.alloc(10), {
        maxBytes: 5,
        quality: 60,
      }),
      { message: "screenshot_too_large" }
    );
  });

  it("treats only decoder errors as undecodable", () => {
    for (const message of [
      "Input buffer contains unsupported image format",
      "Input Buffer is empty",
      "Input buffer has corrupt header: VipsJpeg: premature end of JPEG image",
      "Input image exceeds pixel limit",
      "vipspng: libpng read error",
      "VipsForeignLoad: buffer is not in a known format",
      "webpload_buffer: unable to parse image",
    ]) {
      assert.equal(isUndecodableImageError(new Error(message)), true, message);
    }

    for (const message of [
      "vips_tracked: out of memory",
      "VipsImage: memory area too small",
      "VipsJpeg: Insufficient memory",
      "jpegload_buffer: out of memory",
      "Input buffer has corrupt header: vips_malloc: out of memory",
      "Error: spawn EAGAIN",
    ]) {
      assert.equal(isUndecodableImageError(new Error(message)), false, message);
    }
  });
});
