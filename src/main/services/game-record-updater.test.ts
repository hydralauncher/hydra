import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { createGameRecordUpdater } from "./game-record-updater-core.js";

const game: Game = {
  title: "Portal 2",
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  playTimeInMilliseconds: 600_000,
  unsyncedDeltaPlayTimeInMilliseconds: 120_000,
  lastTimePlayed: null,
  objectId: "620",
  shop: "steam",
  remoteId: "remote-id",
  isDeleted: false,
};

describe("game record updater", () => {
  it("preserves playtime and pending deltas across concurrent setting updates", async () => {
    let storedGame = { ...game };
    const updateGame = createGameRecordUpdater({
      get: async () => ({ ...storedGame }),
      put: async (_key, value) => {
        await Promise.resolve();
        storedGame = { ...value };
      },
    });

    await Promise.all([
      updateGame("steam:620", {
        playTimeInMilliseconds: 660_000,
        unsyncedDeltaPlayTimeInMilliseconds: 180_000,
      }),
      updateGame("steam:620", { disableHydraPlaytimeTracking: true }),
    ]);

    assert.equal(storedGame.playTimeInMilliseconds, 660_000);
    assert.equal(storedGame.unsyncedDeltaPlayTimeInMilliseconds, 180_000);
    assert.equal(storedGame.disableHydraPlaytimeTracking, true);
  });
});
