import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractSimilarGameGenres,
  fetchSimilarGames,
  normalizeSimilarGamesResponse,
  type SimilarGame,
  type SimilarGamesGet,
} from "./similar-games.js";

const game = (
  objectId: string,
  overrides: Partial<SimilarGame> = {}
): SimilarGame => ({
  objectId,
  shop: "steam",
  title: `Game ${objectId}`,
  iconUrl: null,
  libraryHeroImageUrl: null,
  libraryImageUrl: `https://example.com/${objectId}.jpg`,
  coverImageUrl: null,
  logoImageUrl: null,
  downloadSources: [],
  ...overrides,
});

describe("extractSimilarGameGenres", () => {
  it("extracts, trims, and deduplicates supported genre shapes", () => {
    assert.deepEqual(
      extractSimilarGameGenres([
        { name: " RPG " },
        { description: "Strategy" },
        "strategy",
        null,
      ]),
      ["RPG", "Strategy"]
    );
  });
});

describe("normalizeSimilarGamesResponse", () => {
  const query = { objectId: "current", shop: "steam" as const };

  it("preserves server order while excluding invalid identities and duplicates", () => {
    const results = normalizeSimilarGamesResponse(
      [
        game("first"),
        game("current"),
        game("other-shop", { shop: "launchbox" }),
        game("first"),
        game("second"),
      ],
      query
    );

    assert.deepEqual(
      results.map(({ objectId }) => objectId),
      ["first", "second"]
    );
  });

  it("rejects blank identities, trims valid identities, and preserves the limit", () => {
    const results = normalizeSimilarGamesResponse(
      [
        game(" \t "),
        game("blank-title", { title: " \t " }),
        game(" padded-id ", { title: " Padded title " }),
        ...Array.from({ length: 8 }, (_, index) => game(`valid-${index}`)),
      ],
      query
    );

    assert.equal(results.length, 9);
    assert.equal(results[0].objectId, "padded-id");
    assert.equal(results[0].title, "Padded title");
  });

  it("drops malformed download sources and limits results to nine", () => {
    const response = Array.from({ length: 12 }, (_, index) => ({
      ...game(String(index)),
      downloadSources: [
        `Source ${index}`,
        { id: `source-${index}` },
        { name: "Legacy" },
        "",
      ],
    }));

    const results = normalizeSimilarGamesResponse(response, query);

    assert.equal(results.length, 9);
    assert.deepEqual(results[0].downloadSources, ["Source 0"]);
  });

  it("keeps API-resolved profile cover artwork", () => {
    const [result] = normalizeSimilarGamesResponse(
      [
        game("profile-cover", {
          coverImageUrl: "https://example.com/profile-cover.jpg",
        }),
      ],
      query
    );

    assert.equal(result.coverImageUrl, "https://example.com/profile-cover.jpg");
  });

  it("skips malformed games without rejecting usable results", () => {
    const results = normalizeSimilarGamesResponse(
      [
        null,
        { objectId: "broken", shop: "steam" },
        {
          ...game("missing-sources"),
          downloadSources: undefined,
        },
        game("valid"),
      ],
      query
    );

    assert.deepEqual(
      results.map(({ objectId }) => objectId),
      ["missing-sources", "valid"]
    );
    assert.deepEqual(results[0].downloadSources, []);
  });

  it("rejects malformed top-level endpoint responses", () => {
    assert.throws(() => normalizeSimilarGamesResponse({}, query), TypeError);
  });
});

describe("fetchSimilarGames", () => {
  it("calls the similar endpoint with the shared nine-game limit", async () => {
    const calls: Array<{
      path: string;
      options: Parameters<SimilarGamesGet>[1];
    }> = [];
    const get: SimilarGamesGet = async (path, options) => {
      calls.push({ path, options });
      return [game("result")];
    };

    const results = await fetchSimilarGames(
      { objectId: "game/id", shop: "steam" },
      get,
      ["source-b", "source-a"]
    );

    assert.equal(results.length, 1);
    assert.deepEqual(calls, [
      {
        path: "/catalogue/steam/game%2Fid/similar",
        options: {
          params: {
            take: 9,
            downloadSourceIds: ["source-b", "source-a"],
          },
          needsAuth: false,
        },
      },
    ]);
  });

  it("does not request unsupported custom games", async () => {
    let calls = 0;
    const get: SimilarGamesGet = async () => {
      calls += 1;
      return [];
    };

    const results = await fetchSimilarGames(
      { objectId: "custom", shop: "custom" },
      get
    );

    assert.deepEqual(results, []);
    assert.equal(calls, 0);
  });
});
