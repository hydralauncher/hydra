import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { levelKeys } from "../level/sublevels/keys.js";

import {
  gamesPlaytime,
  isGameRunning,
  setGamePlaytime,
} from "./game-running-state.js";

describe("game running state", () => {
  afterEach(() => gamesPlaytime.clear());

  it("reports games recorded through the shared state helper", () => {
    setGamePlaytime(levelKeys.game("steam", "10"), {
      firstTick: 1,
      lastTick: 2,
      lastSyncTick: 3,
    });

    assert.equal(isGameRunning("10", "steam"), true);
    assert.equal(isGameRunning("20", "steam"), false);
  });
});
