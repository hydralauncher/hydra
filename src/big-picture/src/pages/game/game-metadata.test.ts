import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractGenreNames } from "./game-metadata.js";

describe("extractGenreNames", () => {
  it("extracts, trims, and deduplicates supported genre shapes", () => {
    assert.deepEqual(
      extractGenreNames([
        { name: " RPG " },
        { description: "Strategy" },
        "strategy",
        null,
      ]),
      ["RPG", "Strategy"]
    );
  });
});
