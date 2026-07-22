import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getLastArtworkRowIds,
  isAnimatedArtworkItem,
  isArtworkRowSettled,
} from "./game-artwork-utils.js";

describe("isAnimatedArtworkItem", () => {
  it("detects video artwork from either SteamGridDB URL", () => {
    assert.equal(
      isAnimatedArtworkItem({
        url: "https://cdn2.steamgriddb.com/hero/example.webp",
        thumb: "https://cdn2.steamgriddb.com/hero/example.webm",
      }),
      true
    );
    assert.equal(
      isAnimatedArtworkItem({
        url: "https://cdn2.steamgriddb.com/hero/example.mp4?download=1",
        thumb: "https://cdn2.steamgriddb.com/hero/example.webp",
      }),
      true
    );
  });

  it("treats image URLs as static", () => {
    assert.equal(
      isAnimatedArtworkItem({
        url: "https://cdn2.steamgriddb.com/hero/example.webp",
        thumb: "https://cdn2.steamgriddb.com/hero/example.png",
      }),
      false
    );
  });
});

describe("artwork pagination gate", () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));

  it("returns only artwork ids from the last row", () => {
    assert.deepEqual(getLastArtworkRowIds(items, 4), [9, 10]);
    assert.deepEqual(getLastArtworkRowIds(items, 5), [6, 7, 8, 9, 10]);
  });

  it("waits for every artwork in the last row", () => {
    const lastRowIds = getLastArtworkRowIds(items, 4);

    assert.equal(isArtworkRowSettled(lastRowIds, new Set([9])), false);
    assert.equal(isArtworkRowSettled(lastRowIds, new Set([9, 10])), true);
  });

  it("does not let earlier rows block pagination", () => {
    const lastRowIds = getLastArtworkRowIds(items, 4);

    assert.equal(isArtworkRowSettled(lastRowIds, new Set([9, 10])), true);
  });
});
