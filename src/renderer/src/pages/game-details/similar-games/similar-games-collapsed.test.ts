import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readSimilarGamesCollapsed,
  SIMILAR_GAMES_COLLAPSED_STORAGE_KEY,
  storeSimilarGamesCollapsed,
} from "./similar-games-collapsed.js";

const createStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
};

describe("similar games collapsed state", () => {
  it("defaults to expanded when nothing is stored", () => {
    assert.equal(readSimilarGamesCollapsed(createStorage()), false);
    assert.equal(readSimilarGamesCollapsed(null), false);
  });

  it("round-trips the collapsed preference", () => {
    const storage = createStorage();

    storeSimilarGamesCollapsed(true, storage);
    assert.equal(
      storage.values.get(SIMILAR_GAMES_COLLAPSED_STORAGE_KEY),
      "true"
    );
    assert.equal(readSimilarGamesCollapsed(storage), true);

    storeSimilarGamesCollapsed(false, storage);
    assert.equal(readSimilarGamesCollapsed(storage), false);
  });

  it("treats unexpected stored values as expanded", () => {
    const storage = createStorage({
      [SIMILAR_GAMES_COLLAPSED_STORAGE_KEY]: "maybe",
    });

    assert.equal(readSimilarGamesCollapsed(storage), false);
  });

  it("ignores storage failures", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };

    assert.equal(readSimilarGamesCollapsed(throwingStorage), false);
    assert.doesNotThrow(() =>
      storeSimilarGamesCollapsed(true, throwingStorage)
    );
  });
});
