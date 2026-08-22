import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fitScreenshotTo1080p } from "./screenshot-size.js";

describe("souvenir screenshot sizing", () => {
  it("scales 4K screenshots down to 1080p", () => {
    assert.deepEqual(fitScreenshotTo1080p({ width: 3840, height: 2160 }), {
      width: 1920,
      height: 1080,
    });
  });

  it("preserves the aspect ratio of ultrawide screenshots", () => {
    assert.deepEqual(fitScreenshotTo1080p({ width: 3440, height: 1440 }), {
      width: 2580,
      height: 1080,
    });
  });

  it("leaves 1080p screenshots unchanged", () => {
    assert.deepEqual(fitScreenshotTo1080p({ width: 1920, height: 1080 }), {
      width: 1920,
      height: 1080,
    });
  });

  it("does not upscale screenshots below 1080p", () => {
    assert.deepEqual(fitScreenshotTo1080p({ width: 1280, height: 720 }), {
      width: 1280,
      height: 720,
    });
  });
});
