import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { levelKeys } from "../level/sublevels/keys.js";

import {
  clearGamesPlaytimeState,
  deleteGamePlaytime,
  enableHydraPlaytimeForRunningSession,
  gamesPlaytime,
  getGamePlaytimeDeltas,
  getTrackedGamesRunning,
  isGameRunning,
  setGamePlaytime,
} from "./game-running-state.js";
import {
  getDisplayedPlayTimeInMilliseconds,
  mergeLocalAndRemotePlayTime,
} from "../../shared/playtime.js";

describe("game running state", () => {
  afterEach(clearGamesPlaytimeState);

  it("reports games recorded through the shared state helper", () => {
    setGamePlaytime(levelKeys.game("steam", "10"), {
      firstTick: 1,
      lastTick: 2,
      lastSyncTick: 3,
      countHydraPlaytime: true,
    });

    assert.equal(isGameRunning("10", "steam"), true);
    assert.equal(isGameRunning("20", "steam"), false);
    assert.equal(gamesPlaytime.size, 1);
  });

  it("deletes and clears entries through the shared state helpers", () => {
    const firstKey = levelKeys.game("steam", "10");
    const secondKey = levelKeys.game("custom", "20");
    const playtime = {
      firstTick: 1,
      lastTick: 2,
      lastSyncTick: 3,
      countHydraPlaytime: true,
    };

    setGamePlaytime(firstKey, playtime);
    setGamePlaytime(secondKey, playtime);

    assert.equal(deleteGamePlaytime(firstKey), true);
    assert.equal(isGameRunning("10", "steam"), false);
    assert.equal(isGameRunning("20", "custom"), true);

    clearGamesPlaytimeState();

    assert.equal(gamesPlaytime.size, 0);
    assert.equal(isGameRunning("20", "custom"), false);
  });

  it("keeps a Steam session running without counting local or periodic/closing deltas", () => {
    const key = levelKeys.game("steam", "620");
    setGamePlaytime(key, {
      firstTick: 0,
      lastTick: 0,
      lastSyncTick: 0,
      countHydraPlaytime: false,
    });
    let localMilliseconds = 0;
    for (const now of [180_000, 360_000, 540_000, 600_000]) {
      const session = gamesPlaytime.get(key)!;
      const deltas = getGamePlaytimeDeltas(session, now);
      localMilliseconds += deltas.localDelta;
      assert.equal(deltas.syncDelta, 0);
      assert.equal(isGameRunning("620", "steam"), true);
      assert.deepEqual(getTrackedGamesRunning(now), [
        {
          id: key,
          sessionDurationInMillis: now,
        },
      ]);
      setGamePlaytime(key, { ...session, lastTick: now, lastSyncTick: now });
    }
    deleteGamePlaytime(key);
    const merged = mergeLocalAndRemotePlayTime(
      { playTimeInMilliseconds: localMilliseconds },
      { runtimeByPlatform: { hydra: 0, steam: 600 } }
    );
    assert.equal(getDisplayedPlayTimeInMilliseconds(merged), 600_000);
  });

  it("preserves old Hydra pending time across failed Steam-session heartbeats", () => {
    const session = {
      firstTick: 0,
      lastTick: 0,
      lastSyncTick: 0,
      countHydraPlaytime: false,
    };
    const firstAttempt = getGamePlaytimeDeltas(session, 180_000, 60_000);
    const retry = getGamePlaytimeDeltas(
      { ...session, lastSyncTick: 180_000 },
      360_000,
      firstAttempt.syncDelta
    );
    assert.deepEqual(firstAttempt, { localDelta: 0, syncDelta: 60_000 });
    assert.deepEqual(retry, firstAttempt);
    assert.equal(getGamePlaytimeDeltas(session, 600_000, 0).syncDelta, 0);
  });

  it("starts counting a protected running session from the moment the option is enabled", () => {
    const key = levelKeys.game("steam", "620");
    setGamePlaytime(key, {
      firstTick: 0,
      lastTick: 60_000,
      lastSyncTick: 60_000,
      countHydraPlaytime: false,
      syncSteamOnExit: true,
    });

    assert.equal(enableHydraPlaytimeForRunningSession(key, 300_000), true);

    const session = gamesPlaytime.get(key)!;
    assert.equal(session.firstTick, 0);
    assert.equal(session.syncSteamOnExit, true);
    assert.deepEqual(getGamePlaytimeDeltas(session, 360_000), {
      localDelta: 60_000,
      syncDelta: 60_000,
    });
  });

  it("does not reset an already-counting session", () => {
    const key = levelKeys.game("steam", "620");
    setGamePlaytime(key, {
      firstTick: 0,
      lastTick: 60_000,
      lastSyncTick: 60_000,
      countHydraPlaytime: true,
    });

    assert.equal(enableHydraPlaytimeForRunningSession(key, 300_000), true);
    assert.deepEqual(getGamePlaytimeDeltas(gamesPlaytime.get(key)!, 360_000), {
      localDelta: 300_000,
      syncDelta: 300_000,
    });
  });

  it("ignores enable requests when the game is not running", () => {
    assert.equal(
      enableHydraPlaytimeForRunningSession(
        levelKeys.game("steam", "620"),
        300_000
      ),
      false
    );
  });

  it("counts the next Hydra session after disconnect and keeps Steam history", () => {
    const session = {
      firstTick: 0,
      lastTick: 540_000,
      lastSyncTick: 540_000,
      countHydraPlaytime: true,
    };
    assert.deepEqual(getGamePlaytimeDeltas(session, 600_000, 30_000), {
      localDelta: 60_000,
      syncDelta: 90_000,
    });
    assert.equal(
      getDisplayedPlayTimeInMilliseconds({
        playTimeInMilliseconds: 600_000,
        steamPlayTimeInMilliseconds: 3_600_000,
      }),
      4_200_000
    );
  });
});
