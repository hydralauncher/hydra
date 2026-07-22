import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileRemoteArtworkSelection } from "./reconcile-remote-artwork-selection.ts";

const heroSelection = {
  hero: {
    url: "https://cdn2.steamgriddb.com/hero/old.webp",
    artworkId: 123,
  },
};

describe("reconcileRemoteArtworkSelection", () => {
  it("removes a stale selection after a remote reset", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        heroSelection,
        {},
        {
          customHeroImageUrl: null,
        }
      ),
      { selected: {}, changed: true }
    );
  });

  it("keeps a selection matching the remote URL", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        heroSelection,
        {},
        {
          customHeroImageUrl: "https://cdn2.steamgriddb.com/hero/old.webp",
        }
      ),
      { selected: heroSelection, changed: false }
    );
  });

  it("preserves local files and missing remote fields", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        heroSelection,
        { customHeroImageUrl: "local:/tmp/hero.webp" },
        { customHeroImageUrl: null }
      ),
      { selected: heroSelection, changed: false }
    );
    assert.deepEqual(reconcileRemoteArtworkSelection(heroSelection, {}, {}), {
      selected: heroSelection,
      changed: false,
    });
  });
});
