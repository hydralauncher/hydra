import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLauncherStatusReplay,
  getGameLauncherActions,
} from "./game-launcher-state.js";

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
        isCompatibilityLayerFailed: true,
      }),
      { showOpenHydra: false, showClose: true }
    );
  });

  it("keeps the existing open Hydra behavior otherwise", () => {
    assert.deepEqual(
      getGameLauncherActions({
        isMainWindowOpen: false,
        isCompatibilityLayerFailed: false,
      }),
      { showOpenHydra: true, showClose: false }
    );
    assert.deepEqual(
      getGameLauncherActions({
        isMainWindowOpen: true,
        isCompatibilityLayerFailed: false,
      }),
      { showOpenHydra: false, showClose: false }
    );
  });
});
