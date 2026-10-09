import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GAME_LAUNCHER_AUTO_CLOSE_DELAY_MS,
  GAME_STARTED_AUTO_CLOSE_DELAY_MS,
  canGameLauncherAutoClose,
  createLauncherStatusReplay,
  getGameLauncherActions,
  getGameLauncherAutoCloseDelay,
  getLauncherStatusGroup,
} from "./game-launcher-state.js";

describe("game launcher close delay", () => {
  it("closes quickly once the game was detected", () => {
    assert.equal(
      getGameLauncherAutoCloseDelay(true),
      GAME_STARTED_AUTO_CLOSE_DELAY_MS
    );
    assert.equal(
      getGameLauncherAutoCloseDelay(false),
      GAME_LAUNCHER_AUTO_CLOSE_DELAY_MS
    );
    assert.ok(
      GAME_STARTED_AUTO_CLOSE_DELAY_MS < GAME_LAUNCHER_AUTO_CLOSE_DELAY_MS
    );
  });

  it("treats game detection as a compatibility status", () => {
    assert.equal(getLauncherStatusGroup("game_started"), "compatibility");
  });
});

describe("game launcher status replay", () => {
  it("ignores other games before replaying cached statuses", () => {
    const replay = createLauncherStatusReplay("steam:123");

    assert.equal(
      replay.acceptLiveStatus({
        gameKey: "steam:999",
        status: "preparing_compatibility_layer",
        detail: "Downloading steamrt3",
      }),
      false
    );

    assert.deepEqual(
      replay.selectCachedStatuses([
        {
          gameKey: "steam:123",
          status: "preparing_compatibility_layer",
          detail: "Downloading steamrt3",
        },
      ]),
      [
        {
          gameKey: "steam:123",
          status: "preparing_compatibility_layer",
          detail: "Downloading steamrt3",
        },
      ]
    );
  });

  it("keeps live statuses over cached ones of the same group only", () => {
    const replay = createLauncherStatusReplay("steam:123");

    assert.equal(
      replay.acceptLiveStatus({
        gameKey: "steam:123",
        status: "generating_achievements",
        detail: null,
      }),
      true
    );

    assert.deepEqual(
      replay
        .selectCachedStatuses([
          { gameKey: "steam:123", status: "complete", detail: null },
          {
            gameKey: "steam:123",
            status: "compatibility_layer_failed",
            detail: "RuntimeError: runtime setup failed",
          },
        ])
        .map(({ status }) => status),
      ["compatibility_layer_failed"]
    );
  });
});

describe("game launcher actions", () => {
  it("offers a close button for failed setup even with Hydra open", () => {
    assert.deepEqual(
      getGameLauncherActions({
        isMainWindowOpen: true,
        compatibilityLayerStatus: "failed",
      }),
      { showOpenHydra: false, showClose: true }
    );
  });

  it("offers a close button while the compatibility layer is preparing", () => {
    assert.deepEqual(
      getGameLauncherActions({
        isMainWindowOpen: true,
        compatibilityLayerStatus: "preparing",
      }),
      { showOpenHydra: false, showClose: true }
    );
  });

  it("keeps the existing open Hydra behavior otherwise", () => {
    assert.deepEqual(
      getGameLauncherActions({
        isMainWindowOpen: false,
        compatibilityLayerStatus: "idle",
      }),
      { showOpenHydra: true, showClose: false }
    );
    assert.deepEqual(
      getGameLauncherActions({
        isMainWindowOpen: true,
        compatibilityLayerStatus: "idle",
      }),
      { showOpenHydra: false, showClose: false }
    );
  });
});

describe("game launcher auto close", () => {
  it("stays open while setup is preparing even after preflight finished", () => {
    assert.equal(
      canGameLauncherAutoClose({
        preflightFinished: true,
        isGeneratingAchievements: false,
        compatibilityLayerStatus: "preparing",
      }),
      false
    );
  });

  it("closes once setup is idle and nothing else is running", () => {
    assert.equal(
      canGameLauncherAutoClose({
        preflightFinished: true,
        isGeneratingAchievements: false,
        compatibilityLayerStatus: "idle",
      }),
      true
    );
    assert.equal(
      canGameLauncherAutoClose({
        preflightFinished: true,
        isGeneratingAchievements: false,
        compatibilityLayerStatus: "failed",
      }),
      false
    );
  });
});
