import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reconcileRemoteArtworkSelection } from "./reconcile-remote-artwork-selection.ts";

const heroSelection = {
  hero: {
    url: "https://cdn2.steamgriddb.com/hero/old.webp",
    artworkId: 123,
  },
};

const syncedHeroSelection = {
  hero: { ...heroSelection.hero, syncedAt: 1 },
};

describe("reconcileRemoteArtworkSelection", () => {
  it("removes a synced selection after a remote reset", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        syncedHeroSelection,
        {},
        {
          customHeroImageUrl: null,
        }
      ),
      { selected: {}, changed: true }
    );
  });

  it("keeps a selection the remote has never received", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        heroSelection,
        {},
        {
          customHeroImageUrl: null,
        }
      ),
      { selected: heroSelection, changed: false }
    );
  });

  it("keeps an unsynced selection the remote disagrees with", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        heroSelection,
        {},
        {
          customHeroImageUrl: "https://cdn2.steamgriddb.com/hero/new.webp",
        }
      ),
      { selected: heroSelection, changed: false }
    );
  });

  it("removes a synced selection the remote overrides", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        syncedHeroSelection,
        {},
        {
          customHeroImageUrl: "https://cdn2.steamgriddb.com/hero/new.webp",
        }
      ),
      { selected: {}, changed: true }
    );
  });

  it("keeps a selection matching the remote URL", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        syncedHeroSelection,
        {},
        {
          customHeroImageUrl: "https://cdn2.steamgriddb.com/hero/old.webp",
        }
      ),
      { selected: syncedHeroSelection, changed: false }
    );
  });

  it("preserves local files and missing remote fields", () => {
    assert.deepEqual(
      reconcileRemoteArtworkSelection(
        syncedHeroSelection,
        { customHeroImageUrl: "local:/tmp/hero.webp" },
        { customHeroImageUrl: null }
      ),
      { selected: syncedHeroSelection, changed: false }
    );
    assert.deepEqual(
      reconcileRemoteArtworkSelection(syncedHeroSelection, {}, {}),
      {
        selected: syncedHeroSelection,
        changed: false,
      }
    );
  });
});
