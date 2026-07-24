import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CatalogueSearchResult, GameShop } from "@types";
import {
  canonicalizeLocalizedGenres,
  extractSimilarGameGenres,
  fetchSimilarGames,
  getSimilarGameCoverImageUrl,
  rankSimilarGames,
  type SimilarGamesSearch,
} from "./similar-games.js";

describe("extractSimilarGameGenres", () => {
  it("extracts genres from supported data shapes", () => {
    assert.deepEqual(
      extractSimilarGameGenres([
        { id: "1", name: "RPG" },
        { id: "2", description: "Strategy" },
        "Early Access",
      ]),
      ["RPG", "Strategy", "Early Access"]
    );
  });

  it("trims, deduplicates, and ignores malformed genres", () => {
    assert.deepEqual(
      extractSimilarGameGenres([
        { description: " Strategy " },
        { name: "strategy" },
        null,
        { description: 42 },
      ]),
      ["Strategy"]
    );
  });
});

const game = (
  objectId: string,
  genres: string[],
  options: { shop?: GameShop; platform?: string } = {}
): CatalogueSearchResult => ({
  id: objectId,
  objectId,
  title: `Game ${objectId}`,
  shop: options.shop ?? "steam",
  genres,
  releaseYear: 2024,
  libraryImageUrl: null,
  downloadSources: [],
  platform: options.platform,
});

describe("canonicalizeLocalizedGenres", () => {
  const genresByLanguage = {
    en: ["Action", "Adventure", "RPG"],
    pt: ["Ação", "Aventura", "RPG"],
  };

  it("keeps canonical English genres", () => {
    assert.deepEqual(
      canonicalizeLocalizedGenres(["Action", "RPG"], "en", genresByLanguage),
      ["Action", "RPG"]
    );
  });

  it("maps localized genres to their English catalogue values", () => {
    assert.deepEqual(
      canonicalizeLocalizedGenres(
        [" ação ", "AVENTURA"],
        "pt-BR",
        genresByLanguage
      ),
      ["Action", "Adventure"]
    );
  });

  it("falls back to the supplied genre when a language is missing", () => {
    assert.deepEqual(
      canonicalizeLocalizedGenres(["Strategie"], "de", genresByLanguage),
      ["Strategie"]
    );
  });
});

describe("getSimilarGameCoverImageUrl", () => {
  it("uses the existing portrait artwork convention when supported", () => {
    assert.equal(
      getSimilarGameCoverImageUrl(game("1245620", ["RPG"])),
      "https://shared.steamstatic.com/store_item_assets/steam/apps/1245620/library_600x900_2x.jpg"
    );
  });

  it("keeps supplied artwork for other shops", () => {
    const result = game("launchbox-game", ["RPG"], { shop: "launchbox" });
    result.libraryImageUrl = "https://example.com/cover.jpg";

    assert.equal(
      getSimilarGameCoverImageUrl(result),
      "https://example.com/cover.jpg"
    );
  });

  it("returns null when no cover artwork is available", () => {
    assert.equal(
      getSimilarGameCoverImageUrl(
        game("launchbox-game", ["RPG"], { shop: "launchbox" })
      ),
      null
    );
  });
});

describe("rankSimilarGames", () => {
  const query = {
    objectId: "current",
    shop: "steam" as const,
    genres: ["Action", "Adventure", "RPG"],
  };

  it("ranks by overlap, ratio, and stable API order", () => {
    const candidates = [
      game("low-ratio", ["Action", "Adventure", "RPG", "Casual"]),
      game("high-ratio", ["Action", "Adventure", "RPG"]),
      game("stable-first", ["Action"]),
      game("stable-second", ["Action"]),
    ];

    assert.deepEqual(
      rankSimilarGames(candidates, query).map(({ objectId }) => objectId),
      ["high-ratio", "low-ratio", "stable-first", "stable-second"]
    );
  });

  it("deduplicates and excludes the current game, other shops, and no-overlap games", () => {
    const candidates = [
      game("current", ["Action"]),
      game("duplicate", ["Action"]),
      game("duplicate", ["Action", "RPG"]),
      game("other-shop", ["Action"], { shop: "launchbox" }),
      game("no-overlap", ["Strategy"]),
    ];

    assert.deepEqual(
      rankSimilarGames(candidates, query).map(({ objectId }) => objectId),
      ["duplicate"]
    );
  });

  it("keeps LaunchBox results on the current platform when known", () => {
    const launchboxQuery = {
      objectId: "current",
      shop: "launchbox" as const,
      genres: ["Racing"],
      platform: "PlayStation 2",
    };

    assert.deepEqual(
      rankSimilarGames(
        [
          game("ps2", ["Racing"], {
            shop: "launchbox",
            platform: "playstation 2",
          }),
          game("ps1", ["Racing"], {
            shop: "launchbox",
            platform: "PlayStation",
          }),
          game("unknown", ["Racing"], { shop: "launchbox" }),
        ],
        launchboxQuery
      ).map(({ objectId }) => objectId),
      ["ps2"]
    );
  });

  it("matches LaunchBox platform keys and display names canonically", () => {
    const launchboxQuery = {
      objectId: "current",
      shop: "launchbox" as const,
      genres: ["Racing"],
      platform: "PS2",
    };

    assert.deepEqual(
      rankSimilarGames(
        [
          game("same-platform", ["Racing"], {
            shop: "launchbox",
            platform: "Sony Playstation 2",
          }),
          game("different-platform", ["Racing"], {
            shop: "launchbox",
            platform: "Sony Playstation 3",
          }),
        ],
        launchboxQuery
      ).map(({ objectId }) => objectId),
      ["same-platform"]
    );
  });

  it("does not let an invalid duplicate suppress a later valid candidate", () => {
    const launchboxQuery = {
      objectId: "current",
      shop: "launchbox" as const,
      genres: ["Racing"],
      platform: "PlayStation 2",
    };

    assert.deepEqual(
      rankSimilarGames(
        [
          game("duplicate", ["Racing"], {
            shop: "launchbox",
            platform: "PlayStation",
          }),
          game("duplicate", ["Racing"], {
            shop: "launchbox",
            platform: "PlayStation 2",
          }),
        ],
        launchboxQuery
      ).map(({ objectId }) => objectId),
      ["duplicate"]
    );
  });

  it("limits the result set to nine games", () => {
    const candidates = Array.from({ length: 12 }, (_, index) =>
      game(String(index), ["Action"])
    );

    assert.equal(rankSimilarGames(candidates, query).length, 9);
  });
});

describe("fetchSimilarGames", () => {
  const query = {
    objectId: "current",
    shop: "steam" as const,
    genres: ["Ação", "Aventura"],
    language: "pt-BR",
  };
  const genresByLanguage = {
    en: ["Action", "Adventure"],
    pt: ["Ação", "Aventura"],
  };

  it("uses canonical genres and skips fallback when nine results are valid", async () => {
    const payloads: Parameters<SimilarGamesSearch>[0][] = [];
    const search: SimilarGamesSearch = async (payload) => {
      payloads.push(payload);
      return {
        count: 9,
        edges: Array.from({ length: 9 }, (_, index) =>
          game(String(index), ["Action"])
        ),
      };
    };

    const results = await fetchSimilarGames(query, search, genresByLanguage);

    assert.equal(results.length, 9);
    assert.equal(payloads.length, 1);
    assert.deepEqual(payloads[0].genres, ["Action", "Adventure"]);
    assert.equal(payloads[0].shops, undefined);
    assert.equal(payloads[0].platforms, undefined);
    assert.deepEqual(payloads[0].downloadSourceIds, []);
  });

  it("uses catalogue keys for supported LaunchBox platforms", async () => {
    const platformCases = [
      ["Sony Playstation", "ps1"],
      ["Sony Playstation 2", "ps2"],
      ["Sony Playstation 3", "ps3"],
      ["PS2", "ps2"],
    ] as const;

    for (const [platform, expectedKey] of platformCases) {
      const payloads: Parameters<SimilarGamesSearch>[0][] = [];
      const search: SimilarGamesSearch = async (payload) => {
        payloads.push(payload);
        return { count: 0, edges: [] };
      };

      await fetchSimilarGames(
        {
          objectId: "current",
          shop: "launchbox",
          genres: ["Racing"],
          platform,
          language: "en",
        },
        search
      );

      assert.deepEqual(payloads[0].shops, ["launchbox"]);
      assert.deepEqual(payloads[0].platforms, [expectedKey]);
    }
  });

  it("omits unknown LaunchBox platforms from the catalogue request", async () => {
    const payloads: Parameters<SimilarGamesSearch>[0][] = [];
    const search: SimilarGamesSearch = async (payload) => {
      payloads.push(payload);
      return { count: 0, edges: [] };
    };

    await fetchSimilarGames(
      {
        objectId: "current",
        shop: "launchbox",
        genres: ["Racing"],
        platform: "Unknown Console",
        language: "en",
      },
      search
    );

    assert.deepEqual(payloads[0].shops, ["launchbox"]);
    assert.equal(payloads[0].platforms, undefined);
  });

  it("performs one first-genre fallback and merges the candidates", async () => {
    const payloads: Parameters<SimilarGamesSearch>[0][] = [];
    const search: SimilarGamesSearch = async (payload) => {
      payloads.push(payload);
      const isFallback = payload.genres.length === 1;

      return {
        count: isFallback ? 8 : 1,
        edges: isFallback
          ? Array.from({ length: 8 }, (_, index) =>
              game(`fallback-${index}`, ["Action"])
            )
          : [game("strong", ["Action", "Adventure"])],
      };
    };

    const results = await fetchSimilarGames(query, search, genresByLanguage);

    assert.equal(payloads.length, 2);
    assert.deepEqual(payloads[1].genres, ["Action"]);
    assert.deepEqual(
      results.map(({ objectId }) => objectId),
      [
        "strong",
        "fallback-0",
        "fallback-1",
        "fallback-2",
        "fallback-3",
        "fallback-4",
        "fallback-5",
        "fallback-6",
        "fallback-7",
      ]
    );
  });

  it("does not search unsupported custom games", async () => {
    let calls = 0;
    const search: SimilarGamesSearch = async () => {
      calls += 1;
      return { count: 0, edges: [] };
    };

    const results = await fetchSimilarGames(
      { ...query, shop: "custom" },
      search,
      genresByLanguage
    );

    assert.deepEqual(results, []);
    assert.equal(calls, 0);
  });
});
