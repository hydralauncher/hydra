import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAchievementScreenshotPath } from "./achievement-screenshot-path.js";

describe("achievement screenshot paths", () => {
  it("keeps games with the same sanitized title separate", () => {
    const first = resolveAchievementScreenshotPath(
      "/screenshots",
      "Game: One",
      "Winner",
      "game-1",
      "winner"
    );
    const second = resolveAchievementScreenshotPath(
      "/screenshots",
      "Game? One",
      "Winner",
      "game-2",
      "winner"
    );

    assert.notEqual(first, second);
  });

  it("keeps achievements with the same display name separate", () => {
    const first = resolveAchievementScreenshotPath(
      "/screenshots",
      "Game",
      "Winner",
      "game-1",
      "achievement-1"
    );
    const second = resolveAchievementScreenshotPath(
      "/screenshots",
      "Game",
      "Winner",
      "game-1",
      "achievement-2"
    );

    assert.notEqual(first, second);
  });

  it("removes trailing dots and spaces from path segments", () => {
    const screenshotPath = resolveAchievementScreenshotPath(
      "/screenshots",
      "Game...   ",
      "Winner...   ",
      "game-1",
      "achievement-1"
    );

    assert.doesNotMatch(screenshotPath, /[. ]+-/);
  });
});
