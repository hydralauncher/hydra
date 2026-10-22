import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSocialWindowBounds } from "./social-window-bounds.js";

const workAreas = [{ x: 0, y: 0, width: 1920, height: 1040 }];
const minimumSize = { width: 420, height: 560 };

describe("social window bounds", () => {
  it("restores a saved position and size that is on screen", () => {
    assert.deepEqual(
      resolveSocialWindowBounds(
        { x: 1400, y: 120, width: 500, height: 800 },
        workAreas,
        minimumSize
      ),
      { x: 1400, y: 120, width: 500, height: 800 }
    );
  });

  it("keeps only the size when the saved position is off every display", () => {
    assert.deepEqual(
      resolveSocialWindowBounds(
        { x: 3000, y: 200, width: 500, height: 800 },
        workAreas,
        minimumSize
      ),
      { width: 500, height: 800 }
    );
  });

  it("never restores below the window minimum size", () => {
    assert.deepEqual(
      resolveSocialWindowBounds(
        { x: 10, y: 10, width: 200, height: 300 },
        workAreas,
        minimumSize
      ),
      { x: 10, y: 10, width: 420, height: 560 }
    );
  });

  it("drops the position when the title bar is above every display", () => {
    assert.deepEqual(
      resolveSocialWindowBounds(
        { x: 200, y: -300, width: 500, height: 800 },
        workAreas,
        minimumSize
      ),
      { width: 500, height: 800 }
    );
  });

  it("drops the position when only a sliver of the title bar is visible", () => {
    assert.deepEqual(
      resolveSocialWindowBounds(
        { x: 1850, y: 100, width: 500, height: 800 },
        workAreas,
        minimumSize
      ),
      { width: 500, height: 800 }
    );
  });

  it("restores on a secondary display", () => {
    assert.deepEqual(
      resolveSocialWindowBounds(
        { x: -1500, y: 100, width: 600, height: 700 },
        [...workAreas, { x: -1920, y: 0, width: 1920, height: 1080 }],
        minimumSize
      ),
      { x: -1500, y: 100, width: 600, height: 700 }
    );
  });

  it("ignores missing or invalid saved bounds", () => {
    assert.equal(resolveSocialWindowBounds(null, workAreas, minimumSize), null);
    assert.equal(
      resolveSocialWindowBounds(
        { x: Number.NaN, y: 0, width: 500, height: 600 },
        workAreas,
        minimumSize
      ),
      null
    );
  });
});
