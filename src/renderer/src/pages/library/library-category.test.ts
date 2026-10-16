import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as libraryCategory from "./library-category.ts";

const {
  appendProfileLibraryFilterParams,
  filterLibraryGames,
  filterLibraryGamesByCategory,
  getLibraryFilterOptions,
  getLibraryPresentationBadgeSource,
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
  it("filters grouped games by real imported sources instead of presentation", () => {
    const epicOwned = {
      id: "group",
      shop: "epic",
      catalogueGame: { shop: "steam", objectId: "123" },
      availableShops: ["steam", "epic"],
      members: [{ shop: "epic", hasActiveEpicImport: true }],
    };
    const filters = { category: "pc" as const, platforms: [] };
    assert.deepEqual(
      ids(filterLibraryGames([epicOwned], { ...filters, sources: ["epic"] })),
      ["group"]
    );
    assert.deepEqual(
      filterLibraryGames([epicOwned], { ...filters, sources: ["steam"] }),
      []
    );
    const ownedOnBoth = {
      ...epicOwned,
      members: [
        ...epicOwned.members,
        { shop: "steam", hasActiveSteamImport: true },
      ],
    };
    assert.deepEqual(
      ids(
        filterLibraryGames([ownedOnBoth], { ...filters, sources: ["steam"] })
      ),
      ["group"]
    );
    assert.deepEqual(
      ids(
        filterLibraryGames([ownedOnBoth], {
          ...filters,
          sources: ["steam", "epic"],
        })
      ),
      ["group"]
    );
  });
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
    assert.deepEqual(parseStoredLibrarySources('["steam","epic"]'), [
      "steam",
      "epic",
    ]);
    assert.deepEqual(parseStoredLibrarySources('["hydra"]'), ["hydra"]);
    assert.deepEqual(parseStoredLibrarySources('["steam","hydra"]'), [
      "hydra",
      "steam",
    ]);
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
      hasImportedGames: false,
      platforms: [],
    });
    assert.deepEqual(getLibraryFilterOptions(hiddenGames), {
      hasImportedGames: true,
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
      hasImportedGames: false,
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
    assert.deepEqual(getProfileLibraryFilter("pc"), {
      shops: ["steam", "epic"],
    });
    assert.deepEqual(getProfileLibraryFilter("classics"), {
      shops: ["launchbox"],
    });

    const params = new URLSearchParams();
    appendProfileLibraryFilterParams(params, getProfileLibraryFilter("all"));
    assert.equal(params.toString(), "shop=steam&shop=epic&shop=launchbox");
  });
});

describe("Steam badge", () => {
  it("uses real imports instead of catalogue availability or preferred metadata", () => {
    const catalogue = {
      shop: "epic",
      canonicalId: "same-game",
      catalogueGame: { shop: "steam", objectId: "123" },
      availableShops: ["steam", "epic"],
    };
    assert.equal(getLibraryPresentationBadgeSource(catalogue), null);
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveSteamImport: false,
        hasActiveEpicImport: false,
      }),
      null
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveEpicImport: true,
      }),
      "epic"
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveSteamImport: true,
      }),
      "steam"
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...catalogue,
        hasActiveSteamImport: true,
        hasActiveEpicImport: true,
      }),
      "steam"
    );
    assert.deepEqual(catalogue.catalogueGame, {
      shop: "steam",
      objectId: "123",
    });
    assert.deepEqual(catalogue.availableShops, ["steam", "epic"]);
  });

  it("uses active real members and updates the badge when an import is removed", () => {
    const epic = { shop: "epic", hasActiveEpicImport: true };
    const steam = { shop: "steam", hasActiveSteamImport: true };
    const group = {
      shop: "steam",
      hasActiveSteamImport: true,
      hasActiveEpicImport: true,
      members: [steam, epic],
    };
    assert.equal(getLibraryPresentationBadgeSource(group), "steam");
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...group,
        members: [{ ...steam, isDeleted: true }, epic],
      }),
      "epic"
    );
    assert.equal(
      getLibraryPresentationBadgeSource({
        ...group,
        members: [{ ...steam, hasActiveSteamImport: false }, epic],
      }),
      "epic"
    );
    assert.equal(
      getLibraryPresentationBadgeSource({ ...group, members: [] }),
      null
    );
  });

  it("hides Steam badges without changing import membership", () => {
    assert.equal(shouldShowSteamLibraryBadge(games[0]), true);
    assert.equal(shouldShowSteamLibraryBadge(games[0], false), true);
    assert.equal(shouldShowSteamLibraryBadge(games[0], true), false);
    assert.equal(shouldShowSteamLibraryBadge(games[1]), false);
    assert.equal(isSteamLibraryGame(games[0]), true);
  });
});

it("keeps Epic imports distinct and preserves two selected sources", () => {
  const games = [
    { shop: "epic", hasActiveEpicImport: true },
    { shop: "epic", hasActiveEpicImport: false },
    { shop: "steam", hasActiveSteamImport: true },
  ];
  assert.deepEqual(
    filterLibraryGames(games, {
      category: "pc",
      sources: ["epic"],
      platforms: [],
    }),
    [games[0]]
  );
  assert.deepEqual(
    filterLibraryGames(games, {
      category: "pc",
      sources: ["epic", "steam"],
      platforms: [],
    }),
    [games[0], games[2]]
  );
  assert.deepEqual(parseStoredLibrarySources('["epic","hydra"]'), [
    "hydra",
    "epic",
  ]);
  assert.deepEqual(parseStoredLibrarySources('["epic","hydra","steam"]'), []);
});
