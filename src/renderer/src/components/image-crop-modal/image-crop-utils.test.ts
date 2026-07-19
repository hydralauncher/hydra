import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fitImageWithinBounds } from "./image-crop-utils.js";

describe("fitImageWithinBounds", () => {
  it("preserves wide logo proportions", () => {
    assert.deepEqual(
      fitImageWithinBounds(
        { width: 1000, height: 200 },
        { width: 640, height: 360 }
      ),
      { width: 640, height: 128 }
    );
  });

  it("preserves portrait logo proportions", () => {
    assert.deepEqual(
      fitImageWithinBounds(
        { width: 300, height: 900 },
        { width: 640, height: 360 }
      ),
      { width: 120, height: 360 }
    );
  });

  it("uses the full bounds for matching proportions", () => {
    assert.deepEqual(
      fitImageWithinBounds(
        { width: 1600, height: 900 },
        { width: 640, height: 360 }
      ),
      { width: 640, height: 360 }
    );
  });

  it("recalculates dimensions for rotated logos", () => {
    assert.deepEqual(
      fitImageWithinBounds(
        { width: 200, height: 1000 },
        { width: 640, height: 360 }
      ),
      { width: 72, height: 360 }
    );
  });
});
