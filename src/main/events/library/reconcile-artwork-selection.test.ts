import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileArtworkSelection } from "./reconcile-artwork-selection.ts";

describe("reconcileArtworkSelection", () => {
  it("keeps the SteamGridDB artwork id for a cropped local asset", () => {
    const result = reconcileArtworkSelection({}, [
      {
        type: "hero",
        previousUrl: null,
        nextUrl: "local:/tmp/hero.webp",
        artworkId: 123,
      },
    ]);

    assert.deepEqual(result, {
      selected: {
        hero: { url: "local:/tmp/hero.webp", artworkId: 123 },
      },
      changed: true,
    });
  });

  it("clears the previous selection for an imported local asset", () => {
    const result = reconcileArtworkSelection(
      {
        hero: {
          url: "https://cdn2.steamgriddb.com/hero/example.webp",
          artworkId: 123,
        },
      },
      [
        {
          type: "hero",
          previousUrl: null,
          nextUrl: "local:/tmp/hero.webp",
          artworkId: null,
        },
      ]
    );

    assert.deepEqual(result, { selected: {}, changed: true });
  });

  it("does not change unrelated artwork types", () => {
    const grid = {
      url: "https://cdn2.steamgriddb.com/grid/example.webp",
      artworkId: 456,
    };
    const result = reconcileArtworkSelection({ grid }, [
      {
        type: "hero",
        previousUrl: null,
        nextUrl: "local:/tmp/hero.webp",
        artworkId: null,
      },
    ]);

    assert.deepEqual(result, { selected: { grid }, changed: false });
  });
});
