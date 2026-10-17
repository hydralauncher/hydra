import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Game } from "@types";
import {
  belongsToLibraryCollection,
  resetAccountScopedGameState,
} from "./game-visibility.ts";

describe("account game visibility", () => {
  it("puts hidden games only in the private collection", () => {
    const normal = { isDeleted: false, isConcealed: false };
    const hidden = { isDeleted: false, isConcealed: true };
    const deleted = { isDeleted: true, isConcealed: true };

    assert.equal(belongsToLibraryCollection(normal, "visible"), true);
    assert.equal(belongsToLibraryCollection(normal, "hidden"), false);
    assert.equal(belongsToLibraryCollection(hidden, "visible"), false);
    assert.equal(belongsToLibraryCollection(hidden, "hidden"), true);
    assert.equal(belongsToLibraryCollection(deleted, "hidden"), false);
  });

  it("clears one account's flags before another account syncs", () => {
    const game = {
      shop: "steam",
      objectId: "400",
      remoteId: "old-account-game",
      isHiddenFromOthers: true,
      isConcealed: true,
      isDeleted: false,
      title: "Portal",
      playTimeInMilliseconds: 3600,
    } as Game;

    assert.deepEqual(resetAccountScopedGameState(game), {
      ...game,
      remoteId: null,
      isHiddenFromOthers: false,
      isConcealed: false,
    });
  });
});
