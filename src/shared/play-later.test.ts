import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameShop, PlayLaterEntry } from "@types";

import {
  isInLibrary,
  parsePlayLaterSort,
  parsePlayLaterViewMode,
  sortPlayLater,
  withoutLibraryGames,
} from "./play-later.js";

const entry = (shop: GameShop, objectId: string) =>
  ({ shop, objectId, title: objectId, addedAt: 0 }) as PlayLaterEntry;

const at = (title: string, addedAt: number) =>
  ({ shop: "steam", objectId: title, title, addedAt }) as PlayLaterEntry;

describe("isInLibrary", () => {
  it("counts a game linked to a library game through catalogueGame", () => {
    assert.equal(
      isInLibrary({ shop: "steam", objectId: "123" }, [
        {
          shop: "epic",
          objectId: "namespace:item",
          isDeleted: false,
          catalogueGame: { shop: "steam", objectId: "123" },
        },
      ]),
      true
    );
  });

  it("does not count a deleted library game", () => {
    assert.equal(
      isInLibrary({ shop: "steam", objectId: "1" }, [
        { shop: "steam", objectId: "1", isDeleted: true },
      ]),
      false
    );
  });
});

describe("withoutLibraryGames", () => {
  it("drops an entry whose game is in the library", () => {
    assert.deepEqual(
      withoutLibraryGames(
        [entry("steam", "1"), entry("steam", "2")],
        [{ shop: "steam", objectId: "1", isDeleted: false }]
      ),
      [entry("steam", "2")]
    );
  });

  it("drops an entry whose game is linked to a library game through catalogueGame", () => {
    assert.deepEqual(
      withoutLibraryGames(
        [entry("steam", "123")],
        [
          {
            shop: "epic",
            objectId: "namespace:item",
            isDeleted: false,
            catalogueGame: { shop: "steam", objectId: "123" },
          },
        ]
      ),
      []
    );
  });

  it("keeps an entry whose library game is deleted", () => {
    assert.equal(
      withoutLibraryGames(
        [entry("steam", "1")],
        [{ shop: "steam", objectId: "1", isDeleted: true }]
      ).length,
      1
    );
  });

  it("keeps an entry whose objectId matches a library game from another shop", () => {
    assert.equal(
      withoutLibraryGames(
        [entry("launchbox", "1")],
        [{ shop: "steam", objectId: "1", isDeleted: false }]
      ).length,
      1
    );
  });
});

describe("sortPlayLater", () => {
  it("puts the most recently added first", () => {
    assert.deepEqual(
      sortPlayLater([at("a", 1), at("b", 3), at("c", 2)], "addedAt").map(
        (item) => item.addedAt
      ),
      [3, 2, 1]
    );
  });

  it("sorts titles naturally regardless of case and accents", () => {
    assert.deepEqual(
      sortPlayLater(
        [at("Zelda", 0), at("Élden", 0), at("alan wake", 0)],
        "title"
      ).map((item) => item.title),
      ["alan wake", "Élden", "Zelda"]
    );
  });

  it("does not mutate its input", () => {
    const input = [at("b", 1), at("a", 2)];
    sortPlayLater(input, "title");
    assert.deepEqual(
      input.map((item) => item.title),
      ["b", "a"]
    );
  });
});

describe("saved Play later display choices", () => {
  it("restores a saved view mode", () => {
    assert.equal(parsePlayLaterViewMode("grid"), "grid");
    assert.equal(parsePlayLaterViewMode("large"), "large");
  });

  it("falls back to the compact view, like the library", () => {
    assert.equal(parsePlayLaterViewMode(null), "compact");
    assert.equal(parsePlayLaterViewMode("huge"), "compact");
  });

  it("restores a saved sort and falls back to date added", () => {
    assert.equal(parsePlayLaterSort("title"), "title");
    assert.equal(parsePlayLaterSort(null), "addedAt");
    assert.equal(parsePlayLaterSort("rating"), "addedAt");
  });
});
