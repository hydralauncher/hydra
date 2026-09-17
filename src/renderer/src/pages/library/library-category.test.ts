import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as libraryCategory from "./library-category.ts";

const {
  appendProfileLibraryFilterParams,
  filterLibraryGamesByCategory,
  getProfileLibraryFilter,
  shouldShowProfileSteamLibraryBadge,
} = libraryCategory;

const games = [
  { id: "steam-import", shop: "steam", hasActiveSteamImport: true },
  { id: "steam-local", shop: "steam", hasActiveSteamImport: false },
  { id: "classics", shop: "launchbox", hasActiveSteamImport: false },
];

describe("Steam Library filters", () => {
  it("selects only active Steam imports", () => {
    assert.deepEqual(
      filterLibraryGamesByCategory(games, "steam_library").map(
        (game) => game.id
      ),
      ["steam-import"]
    );
  });

  it("preserves existing category behavior", () => {
    assert.deepEqual(
      filterLibraryGamesByCategory(games, "pc").map((game) => game.id),
      ["steam-import", "steam-local"]
    );
    assert.deepEqual(
      filterLibraryGamesByCategory(games, "classics").map((game) => game.id),
      ["classics"]
    );
    assert.equal(filterLibraryGamesByCategory(games, "all"), games);
  });

  it("builds the remote Steam Library filter", () => {
    const filter = getProfileLibraryFilter("steam_library");
    assert.deepEqual(filter, {
      shops: ["steam"],
      steamLibrary: true,
    });
    assert.deepEqual(getProfileLibraryFilter("pc"), {
      shops: ["steam"],
      steamLibrary: false,
    });

    const params = new URLSearchParams();
    appendProfileLibraryFilterParams(params, filter);
    assert.equal(params.toString(), "shop=steam&steamLibrary=true");
  });

  it("shows the Steam badge only for imports on the owner's profile", () => {
    assert.equal(shouldShowProfileSteamLibraryBadge(games[0], true), true);
    assert.equal(shouldShowProfileSteamLibraryBadge(games[0], false), false);
    assert.equal(shouldShowProfileSteamLibraryBadge(games[1], true), false);
  });
});
