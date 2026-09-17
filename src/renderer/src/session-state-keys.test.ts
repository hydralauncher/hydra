import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSessionScopedKeysToClear } from "./session-state-keys.js";

const persistedFilterKeys = [
  "library-sort-by",
  "library-category",
  "library-collection",
  "library-platforms",
  "library-installed-only",
  "sidebar-category",
  "sidebar-sort-by",
  "sidebar-favorites-first",
  "sidebar-platforms",
  "sidebar-playable-only",
  "profile-sort-by",
  "profile-platform",
  "profile-souvenir-sort-by",
  "profile-souvenir-grouping",
  "hydra:big-picture:library-sort-by",
  "hydra:big-picture:library-filter-by",
  "hydra:big-picture:library-tab",
  "hydra:big-picture:sidebar-library-filter",
];

const alwaysClearedKeys = [
  "settings-category",
  "settings-emulation-view",
  "settings-retroarch-tab",
  "library-view-mode",
  "hydra:big-picture:library-view-mode",
];

describe("getSessionScopedKeysToClear", () => {
  it("keeps every sort and filter when persistence is enabled", () => {
    const keys = getSessionScopedKeysToClear(true);

    for (const key of persistedFilterKeys) {
      assert.equal(keys.includes(key), false, `${key} should be kept`);
    }
  });

  it("still clears navigation and view state when persistence is enabled", () => {
    const keys = getSessionScopedKeysToClear(true);

    for (const key of alwaysClearedKeys) {
      assert.equal(keys.includes(key), true, `${key} should be cleared`);
    }
  });

  it("clears sorts and filters when persistence is disabled", () => {
    const keys = getSessionScopedKeysToClear(false);

    for (const key of [...persistedFilterKeys, ...alwaysClearedKeys]) {
      assert.equal(keys.includes(key), true, `${key} should be cleared`);
    }
  });

  it("returns a fresh list without duplicates", () => {
    const keys = getSessionScopedKeysToClear(false);

    assert.equal(new Set(keys).size, keys.length);
    assert.notEqual(getSessionScopedKeysToClear(true), keys);
  });
});
