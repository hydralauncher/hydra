import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileArtworkSelection } from "./reconcile-artwork-selection.ts";

describe("reconcileArtworkSelection", () => {
  it("keeps the SteamGridDB indicator for a cropped custom asset", () => {
    const result = reconcileArtworkSelection({}, [
      {
        type: "grid",
        previousUrl: null,
        nextUrl: "local:/tmp/cropped.webp",
        artworkId: 42,
      },
    ]);

    assert.deepEqual(result, {
      changed: true,
      selected: {
        grid: {
          url: "local:/tmp/cropped.webp",
          artworkId: 42,
        },
      },
    });
  });

  it("clears an existing SteamGridDB selection for a local upload", () => {
    const result = reconcileArtworkSelection(
      {
        hero: {
          url: "https://cdn2.steamgriddb.com/hero.png",
          artworkId: 10,
        },
      },
      [
        {
          type: "hero",
          previousUrl: null,
          nextUrl: "local:/tmp/upload.webp",
        },
      ]
    );

    assert.deepEqual(result, { changed: true, selected: {} });
  });

  it("clears selection when the custom asset is reset", () => {
    const result = reconcileArtworkSelection(
      {
        icon: {
          url: "local:/tmp/cropped.webp",
          artworkId: 7,
        },
      },
      [
        {
          type: "icon",
          previousUrl: "local:/tmp/cropped.webp",
          nextUrl: null,
        },
      ]
    );

    assert.deepEqual(result, { changed: true, selected: {} });
  });

  it("clears a direct SteamGridDB selection when requested", () => {
    const result = reconcileArtworkSelection(
      {
        grid: {
          url: "https://cdn2.steamgriddb.com/grid.png",
          artworkId: 8,
        },
      },
      [
        {
          type: "grid",
          previousUrl: null,
          nextUrl: null,
          clear: true,
        },
      ]
    );

    assert.deepEqual(result, { changed: true, selected: {} });
  });

  it("ignores unchanged fields", () => {
    const current = {
      logo: {
        url: "https://cdn2.steamgriddb.com/logo.png",
        artworkId: 5,
      },
    };

    const result = reconcileArtworkSelection(current, [
      {
        type: "logo",
        previousUrl: null,
        nextUrl: undefined,
      },
      {
        type: "grid",
        previousUrl: undefined,
        nextUrl: null,
      },
    ]);

    assert.deepEqual(result, { changed: false, selected: current });
  });
});
