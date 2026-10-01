import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as libraryCategory from "./library-category.ts";

const {
  appendProfileLibraryFilterParams,
  filterLibraryGames,
  filterLibraryGamesByCategory,
  getLibraryFilterOptions,
  getProfileLibraryFilter,
  hasSteamLibraryGames,
  isSteamLibraryGame,
  parseStoredLibrarySources,
  readStoredLibraryFilters,
  resolveStoredLibraryCategory,
  shouldShowSteamLibraryBadge,
} = libraryCategory;

const games = [
  { id: "steam-import", shop: "steam", hasActiveSteamImport: true },
  { id: "steam-local", shop: "steam", hasActiveSteamImport: false },
  { id: "custom", shop: "custom" },
  {
    id: "snes",
    shop: "launchbox",
    hasActiveSteamImport: false,
    platform: "SNES",
  },
  {
    id: "n64",
    shop: "launchbox",
    hasActiveSteamImport: false,
    platform: "N64",
  },
];

const ids = (list: { id: string }[]) => list.map((game) => game.id);

describe("Library categories", () => {
  it("splits PC and classics games", () => {
    assert.deepEqual(ids(filterLibraryGamesByCategory(games, "pc")), [
      "steam-import",
      "steam-local",
      "custom",
    ]);
    assert.deepEqual(ids(filterLibraryGamesByCategory(games, "classics")), [
      "snes",
      "n64",
    ]);
    assert.equal(filterLibraryGamesByCategory(games, "all"), games);
  });

  it("migrates the removed Steam Library category to PC with the Steam library", () => {
    assert.deepEqual(resolveStoredLibraryCategory("steam_library"), {
      category: "pc",
      sources: ["steam"],
    });
    assert.deepEqual(resolveStoredLibraryCategory("classics"), {
      category: "classics",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory("unknown"), {
      category: "all",
      sources: null,
    });
    assert.deepEqual(resolveStoredLibraryCategory(null), {
      category: "all",
      sources: null,
    });
  });

  it("rewrites a stored Steam Library category once", () => {
    const values = new Map<string, string>([["category", "steam_library"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    assert.deepEqual(readStoredLibraryFilters(storage, "category", "sources"), {
      category: "pc",
      sources: ["steam"],
    });
    assert.equal(values.get("category"), "pc");
    assert.equal(values.get("sources"), '["steam"]');
    assert.deepEqual(readStoredLibraryFilters(storage, "category", "sources"), {
      category: "pc",
      sources: ["steam"],
    });
  });

  it("reads a single known library from storage", () => {
    assert.deepEqual(parseStoredLibrarySources('["steam","epic"]'), ["steam"]);
    assert.deepEqual(parseStoredLibrarySources('["hydra"]'), ["hydra"]);
    assert.deepEqual(parseStoredLibrarySources('["steam","hydra"]'), []);
    assert.deepEqual(parseStoredLibrarySources("not json"), []);
    assert.deepEqual(parseStoredLibrarySources('{"steam":true}'), []);
    assert.deepEqual(parseStoredLibrarySources(null), []);
  });
});

describe("Library and console filters", () => {
  it("uses the selected hidden library's sources and consoles independently", () => {
    const visibleGames = [{ id: "visible-pc", shop: "steam" }];
    const hiddenGames = [
      { id: "hidden-steam", shop: "steam", hasActiveSteamImport: true },
      { id: "hidden-hydra", shop: "steam" },
      { id: "hidden-snes", shop: "launchbox", platform: "SNES" },
      { id: "hidden-n64", shop: "launchbox", platform: "N64" },
      { id: "hidden-n64-2", shop: "launchbox", platform: "N64" },
    ];

    assert.deepEqual(getLibraryFilterOptions(visibleGames), {
      hasSteamGames: false,
      platforms: [],
    });
    assert.deepEqual(getLibraryFilterOptions(hiddenGames), {
      hasSteamGames: true,
      platforms: ["N64", "SNES"],
    });
    assert.deepEqual(
      ids(
        filterLibraryGames(hiddenGames, {
          category: "all",
          sources: ["steam"],
          platforms: ["SNES"],
        })
      ),
      ["hidden-steam", "hidden-snes"]
    );
    assert.deepEqual(getLibraryFilterOptions([]), {
      hasSteamGames: false,
      platforms: [],
    });
  });

  it("returns every game in the category when nothing is selected", () => {
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "all",
          sources: [],
          platforms: [],
        })
      ),
      ids(games)
    );
  });

  it("filters PC games by library", () => {
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "pc",
          sources: ["steam"],
          platforms: [],
        })
      ),
      ["steam-import"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "pc",
          sources: ["hydra"],
          platforms: [],
        })
      ),
      ["steam-local", "custom"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "pc",
          sources: ["hydra", "steam"],
          platforms: [],
        })
      ),
      ["steam-import", "steam-local", "custom"]
    );
  });

  it("ignores consoles on PC and libraries on classics", () => {
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "pc",
          sources: [],
          platforms: ["SNES"],
        })
      ),
      ["steam-import", "steam-local", "custom"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "classics",
          sources: ["steam"],
          platforms: ["N64"],
        })
      ),
      ["n64"]
    );
  });

  it("narrows each side independently on All", () => {
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "all",
          sources: ["steam"],
          platforms: [],
        })
      ),
      ["steam-import", "snes", "n64"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "all",
          sources: [],
          platforms: ["SNES"],
        })
      ),
      ["steam-import", "steam-local", "custom", "snes"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames(games, {
          category: "all",
          sources: ["hydra"],
          platforms: ["N64"],
        })
      ),
      ["steam-local", "custom", "n64"]
    );
  });

  it("detects Steam imports", () => {
    assert.equal(hasSteamLibraryGames(games), true);
    assert.equal(hasSteamLibraryGames(games.slice(1)), false);
  });
});

describe("Profile library filter", () => {
  it("maps profile platforms to shops", () => {
    assert.deepEqual(getProfileLibraryFilter("pc"), { shops: ["steam"] });
    assert.deepEqual(getProfileLibraryFilter("classics"), {
      shops: ["launchbox"],
    });

    const params = new URLSearchParams();
    appendProfileLibraryFilterParams(params, getProfileLibraryFilter("all"));
    assert.equal(params.toString(), "shop=steam&shop=launchbox");
  });
});

describe("Steam badge", () => {
  it("hides Steam badges without changing import membership", () => {
    assert.equal(shouldShowSteamLibraryBadge(games[0]), true);
    assert.equal(shouldShowSteamLibraryBadge(games[0], false), true);
    assert.equal(shouldShowSteamLibraryBadge(games[0], true), false);
    assert.equal(shouldShowSteamLibraryBadge(games[1]), false);
    assert.equal(isSteamLibraryGame(games[0]), true);
  });
});
