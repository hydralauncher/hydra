import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getScrollbarThumb,
  getScrollDeltaForThumb,
  MIN_THUMB_HEIGHT,
} from "./chat-scrollbar-math.js";

describe("getScrollbarThumb", () => {
  it("has no thumb when the content fits", () => {
    assert.equal(
      getScrollbarThumb(
        { scrollHeight: 400, clientHeight: 400, scrollFromTop: 0 },
        392
      ),
      null
    );
  });

  it("sizes the thumb by the visible share of the content", () => {
    assert.deepEqual(
      getScrollbarThumb(
        { scrollHeight: 800, clientHeight: 400, scrollFromTop: 0 },
        400
      ),
      { top: 0, height: 200 }
    );
  });

  it("puts the thumb at the end of the track when scrolled to the bottom", () => {
    assert.deepEqual(
      getScrollbarThumb(
        { scrollHeight: 800, clientHeight: 400, scrollFromTop: 400 },
        400
      ),
      { top: 200, height: 200 }
    );
  });

  it("keeps a long history's thumb large enough to grab", () => {
    const thumb = getScrollbarThumb(
      { scrollHeight: 100_000, clientHeight: 400, scrollFromTop: 0 },
      400
    );

    assert.equal(thumb?.height, MIN_THUMB_HEIGHT);
  });
});

describe("getScrollDeltaForThumb", () => {
  it("scales a thumb drag to the content", () => {
    assert.equal(
      getScrollDeltaForThumb(
        50,
        { scrollHeight: 800, clientHeight: 400, scrollFromTop: 0 },
        400
      ),
      100
    );
  });

  it("does nothing when the content fits", () => {
    assert.equal(
      getScrollDeltaForThumb(
        50,
        { scrollHeight: 400, clientHeight: 400, scrollFromTop: 0 },
        392
      ),
      0
    );
  });
});
