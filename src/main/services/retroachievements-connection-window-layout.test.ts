import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTH_WINDOW_CONTENT_HEIGHT,
  AUTH_WINDOW_CONTENT_WIDTH,
  CUSTOM_WINDOW_BORDER_WIDTH,
  CUSTOM_WINDOW_TITLE_BAR_HEIGHT,
} from "../../shared/window-layout.js";
import { getRetroAchievementsConnectionWindowLayout } from "./retroachievements-connection-window-layout.js";

describe("getRetroAchievementsConnectionWindowLayout", () => {
  it("matches the native Hydra auth window on Windows and macOS", () => {
    const expected = {
      width: AUTH_WINDOW_CONTENT_WIDTH,
      height: AUTH_WINDOW_CONTENT_HEIGHT,
      frame: true,
      minimizable: false,
    };

    assert.deepEqual(
      getRetroAchievementsConnectionWindowLayout("win32"),
      expected
    );
    assert.deepEqual(
      getRetroAchievementsConnectionWindowLayout("darwin"),
      expected
    );
  });

  it("reserves space for the Linux title bar and border", () => {
    assert.deepEqual(getRetroAchievementsConnectionWindowLayout("linux"), {
      width: AUTH_WINDOW_CONTENT_WIDTH + CUSTOM_WINDOW_BORDER_WIDTH * 2,
      height:
        AUTH_WINDOW_CONTENT_HEIGHT +
        CUSTOM_WINDOW_TITLE_BAR_HEIGHT +
        CUSTOM_WINDOW_BORDER_WIDTH * 2,
      frame: false,
      minimizable: true,
    });
  });
});
