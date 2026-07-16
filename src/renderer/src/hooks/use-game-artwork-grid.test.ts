import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isAnimatedArtworkItem } from "./game-artwork-utils.js";

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
