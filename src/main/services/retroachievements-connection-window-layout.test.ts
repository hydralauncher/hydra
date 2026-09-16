import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRetroAchievementsConnectionWindowLayout } from "./retroachievements-connection-window-layout.js";

describe("getRetroAchievementsConnectionWindowLayout", () => {
  it("matches the native Hydra auth window on Windows and macOS", () => {
    const expected = {
      width: 600,
      height: 640,
      frame: true,
      minimizable: false,
    };

    assert.deepEqual(
      getRetroAchievementsConnectionWindowLayout("win32", 600, 640, 34, 1),
      expected
    );
    assert.deepEqual(
      getRetroAchievementsConnectionWindowLayout("darwin", 600, 640, 34, 1),
      expected
    );
  });

  it("reserves space for the Linux title bar and border", () => {
    assert.deepEqual(
      getRetroAchievementsConnectionWindowLayout("linux", 600, 640, 34, 1),
      {
        width: 602,
        height: 676,
        frame: false,
        minimizable: true,
      }
    );
  });
});
