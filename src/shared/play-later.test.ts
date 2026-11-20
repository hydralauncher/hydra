import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GameShop, PlayLaterEntry } from "@types";

import { sortPlayLater, withoutLibraryGames } from "./play-later.js";

const entry = (shop: GameShop, objectId: string) =>
  ({ shop, objectId, title: objectId, addedAt: 0 }) as PlayLaterEntry;

const at = (title: string, addedAt: number) =>
  ({ shop: "steam", objectId: title, title, addedAt }) as PlayLaterEntry;

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
