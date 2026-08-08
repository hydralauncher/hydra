import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_BIG_PICTURE_UI_SCALE,
  getBigPictureZoomFactor,
  resolveBigPictureUiScale,
} from "../../types/big-picture-ui-scale.ts";

describe("Big Picture UI scale", () => {
  it("accepts every supported UI scale", () => {
    for (const scale of [75, 100, 125, 150, 175, 200]) {
      assert.equal(resolveBigPictureUiScale(scale), scale);
    }
  });

  it("falls back to 100% for missing or invalid UI scales", () => {
    assert.equal(
      resolveBigPictureUiScale(undefined),
      DEFAULT_BIG_PICTURE_UI_SCALE
    );
    assert.equal(resolveBigPictureUiScale(null), DEFAULT_BIG_PICTURE_UI_SCALE);
    assert.equal(resolveBigPictureUiScale(110), DEFAULT_BIG_PICTURE_UI_SCALE);
    assert.equal(resolveBigPictureUiScale("150"), DEFAULT_BIG_PICTURE_UI_SCALE);
  });

  it("converts the selected UI scale to an Electron zoom factor", () => {
    assert.equal(getBigPictureZoomFactor(75), 0.75);
    assert.equal(getBigPictureZoomFactor(150), 1.5);
    assert.equal(getBigPictureZoomFactor("invalid"), 1);
  });
});
