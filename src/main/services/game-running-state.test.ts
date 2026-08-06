import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { levelKeys } from "../level/sublevels/keys.js";

import {
  clearGamesPlaytimeState,
  deleteGamePlaytime,
  gamesPlaytime,
  isGameRunning,
  setGamePlaytime,
} from "./game-running-state.js";

describe("game running state", () => {
  afterEach(clearGamesPlaytimeState);

  it("reports games recorded through the shared state helper", () => {
    setGamePlaytime(levelKeys.game("steam", "10"), {
      firstTick: 1,
      lastTick: 2,
      lastSyncTick: 3,
    });

    assert.equal(isGameRunning("10", "steam"), true);
    assert.equal(isGameRunning("20", "steam"), false);
    assert.equal(gamesPlaytime.size, 1);
  });

  it("deletes and clears entries through the shared state helpers", () => {
    const firstKey = levelKeys.game("steam", "10");
    const secondKey = levelKeys.game("custom", "20");
    const playtime = { firstTick: 1, lastTick: 2, lastSyncTick: 3 };

    setGamePlaytime(firstKey, playtime);
    setGamePlaytime(secondKey, playtime);

    assert.equal(deleteGamePlaytime(firstKey), true);
    assert.equal(isGameRunning("10", "steam"), false);
    assert.equal(isGameRunning("20", "custom"), true);

    clearGamesPlaytimeState();

    assert.equal(gamesPlaytime.size, 0);
    assert.equal(isGameRunning("20", "custom"), false);
  });
});
