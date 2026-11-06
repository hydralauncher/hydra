import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LibraryGame } from "@types";

import { buildLibraryNavigationModel } from "./library-navigation-model.js";
import { LIBRARY_FILTERS_TOOLBAR_REGION_ID } from "./navigation.js";

const games = Array.from({ length: 7 }, (_, index) => ({
  id: `game-${index}`,
})) as LibraryGame[];
const getItemId = (gameId: string) => `item-${gameId}`;

describe("buildLibraryNavigationModel", () => {
  it("builds rows and navigation overrides for a full grid", () => {
    const model = buildLibraryNavigationModel(games, 3, getItemId);

    assert.equal(model.rows.length, 3);
    assert.equal(model.firstItemId, "item-game-0");
    assert.equal(model.rowByItemId.get("item-game-4"), 1);

    assert.deepEqual(model.overridesByItemId["item-game-0"], {
      right: { type: "item", itemId: "item-game-1" },
      up: {
        type: "region",
        regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
        entryDirection: "down",
      },
      down: { type: "item", itemId: "item-game-3" },
    });

    assert.deepEqual(model.overridesByItemId["item-game-2"], {
      left: { type: "item", itemId: "item-game-1" },
      right: { type: "block" },
      up: {
        type: "region",
        regionId: LIBRARY_FILTERS_TOOLBAR_REGION_ID,
        entryDirection: "down",
      },
      down: { type: "item", itemId: "item-game-5" },
    });
  });

  it("clamps navigation into a short final row", () => {
    const model = buildLibraryNavigationModel(games, 3, getItemId);

    assert.deepEqual(model.overridesByItemId["item-game-4"], {
      left: { type: "item", itemId: "item-game-3" },
      right: { type: "item", itemId: "item-game-5" },
      up: { type: "item", itemId: "item-game-1" },
      down: { type: "item", itemId: "item-game-6" },
    });

    assert.deepEqual(model.overridesByItemId["item-game-6"], {
      right: { type: "block" },
      up: { type: "item", itemId: "item-game-3" },
      down: { type: "block" },
    });
  });

  it("supports list layouts with different column counts", () => {
    const twoColumns = buildLibraryNavigationModel(games, 2, getItemId);
    const fourColumns = buildLibraryNavigationModel(games, 4, getItemId);

    assert.equal(twoColumns.rows.length, 4);
    assert.equal(fourColumns.rows.length, 2);
    assert.equal(
      fourColumns.overridesByItemId["item-game-3"]?.right?.type,
      "block"
    );
    assert.equal(
      twoColumns.overridesByItemId["item-game-1"]?.right?.type,
      "block"
    );
  });

  it("handles an empty library", () => {
    const model = buildLibraryNavigationModel([], 4, getItemId);

    assert.deepEqual(model.rows, []);
    assert.equal(model.firstItemId, null);
    assert.deepEqual(model.overridesByItemId, {});
    assert.equal(model.rowByItemId.size, 0);
  });
});
