import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveAchievementScreenshotPath,
  sanitizePathSegment,
} from "./achievement-screenshot-path.js";

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

  it("removes a trailing dot left behind by trimming other whitespace", () => {
    assert.equal(sanitizePathSegment("Vol.\u00A0"), "Vol");
    assert.equal(
      sanitizePathSegment(`${"x".repeat(118)}.\u3000Part 2`),
      "x".repeat(118)
    );
  });
});
