import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LibraryGame } from "@types";
import {
  isSameLibraryList,
  reconcileLibraryGames,
} from "./library-reconcile.js";

const makeGame = (overrides: Partial<LibraryGame> = {}) =>
  ({
    id: "steam:1",
    shop: "steam",
    objectId: "1",
    title: "Game",
    collectionIds: ["a"],
    lastTimePlayed: new Date(1000),
    download: null,
    ...overrides,
  }) as LibraryGame;

describe("reconcileLibraryGames", () => {
  it("returns the previous list when nothing changed", () => {
    const previous = [makeGame(), makeGame({ objectId: "2", id: "steam:2" })];
    const next = previous.map((game) => structuredClone(game));

    assert.equal(reconcileLibraryGames(previous, next), previous);
  });

  it("keeps unchanged games and replaces changed ones", () => {
    const unchanged = makeGame();
    const changed = makeGame({ objectId: "2", id: "steam:2" });
    const updated = { ...structuredClone(changed), title: "Renamed" };

    const result = reconcileLibraryGames(
      [unchanged, changed],
      [structuredClone(unchanged), updated]
    );

    assert.notEqual(result, [unchanged, changed]);
    assert.equal(result[0], unchanged);
    assert.equal(result[1], updated);
  });

  it("detects nested, date and key changes", () => {
    const game = makeGame();

    for (const next of [
      { ...structuredClone(game), collectionIds: ["a", "b"] },
      { ...structuredClone(game), lastTimePlayed: new Date(2000) },
      { ...structuredClone(game), favorite: true },
    ]) {
      assert.equal(reconcileLibraryGames([game], [next])[0], next);
    }
  });

  it("reports a new list when order or size changes", () => {
    const first = makeGame();
    const second = makeGame({ objectId: "2", id: "steam:2" });

    const reordered = reconcileLibraryGames([first, second], [second, first]);
    assert.deepEqual(reordered, [second, first]);
    assert.equal(reordered[0], second);
    assert.equal(reconcileLibraryGames([first, second], [first]).length, 1);
  });
});

describe("isSameLibraryList", () => {
  it("compares items by reference", () => {
    const game = makeGame();

    assert.equal(isSameLibraryList([game], [game]), true);
    assert.equal(isSameLibraryList([game], [structuredClone(game)]), false);
  });
});
