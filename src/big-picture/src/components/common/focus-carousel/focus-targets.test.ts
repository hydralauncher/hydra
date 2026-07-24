import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getDirectionBiasedFocusIndexes } from "./focus-targets.js";

describe("getDirectionBiasedFocusIndexes", () => {
  it("uses the single middle game for an odd visible count", () => {
    assert.deepEqual(getDirectionBiasedFocusIndexes([3, 4, 5]), {
      previous: 4,
      next: 4,
    });
  });

  it("uses the right and left middle games for an even visible count", () => {
    assert.deepEqual(getDirectionBiasedFocusIndexes([2, 3, 4, 5]), {
      previous: 4,
      next: 3,
    });
  });

  it("works at the beginning and end of a carousel", () => {
    assert.deepEqual(getDirectionBiasedFocusIndexes([0, 1, 2, 3]), {
      previous: 2,
      next: 1,
    });
    assert.deepEqual(getDirectionBiasedFocusIndexes([5, 6, 7, 8]), {
      previous: 7,
      next: 6,
    });
  });

  it("returns no targets when no games are visible", () => {
    assert.deepEqual(getDirectionBiasedFocusIndexes([]), {
      previous: null,
      next: null,
    });
  });
});
