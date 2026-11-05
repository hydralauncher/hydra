import assert from "node:assert/strict";
import { it } from "node:test";

import {
  getLibraryGridColumnCount,
  isLibraryCardSize,
} from "./library-card-size.js";

it("accepts only known library card sizes", () => {
  assert.equal(isLibraryCardSize("small"), true);
  assert.equal(isLibraryCardSize("medium"), true);
  assert.equal(isLibraryCardSize("large"), true);
  assert.equal(isLibraryCardSize("huge"), false);
  assert.equal(isLibraryCardSize(null), false);
  assert.equal(isLibraryCardSize(undefined), false);
});

it("adds columns for small cards and removes them for large cards", () => {
  assert.equal(getLibraryGridColumnCount(6, "small"), 8);
  assert.equal(getLibraryGridColumnCount(6, "medium"), 6);
  assert.equal(getLibraryGridColumnCount(6, "large"), 5);
});

it("never goes below one column", () => {
  assert.equal(getLibraryGridColumnCount(1, "large"), 1);
  assert.equal(getLibraryGridColumnCount(0, "medium"), 1);
});
