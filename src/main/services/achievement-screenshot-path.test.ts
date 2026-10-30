import assert from "node:assert/strict";
import { describe, it } from "node:test";

import path from "node:path";

import {
  resolveAchievementScreenshotPath,
  sanitizePathSegment,
} from "./achievement-screenshot-path.js";
import { resolveManualScreenshotPath } from "./screenshots/screenshot-file-path.js";

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

describe("manual screenshot paths", () => {
  const capturedAt = new Date(2026, 9, 29, 12, 0, 0, 0);
  const folderOf = (gameTitle: string) =>
    path.basename(
      path.dirname(resolveManualScreenshotPath("root", gameTitle, capturedAt))
    );

  it("moves game folders off Windows reserved device names", () => {
    assert.equal(folderOf("Con"), "Con_");
    assert.equal(folderOf("nul."), "nul_");
    assert.equal(folderOf("COM1"), "COM1_");
    assert.equal(folderOf("lpt9.remastered"), "lpt9_.remastered");
    assert.equal(folderOf("CON .x"), "CON_ .x");
    assert.equal(folderOf("com1   .remastered"), "com1_   .remastered");
    assert.equal(folderOf("CONIN$"), "CONIN$_");
    assert.equal(folderOf("conout$ .x"), "conout$_ .x");
    assert.equal(folderOf("Clock$"), "Clock$_");
    assert.equal(folderOf("Console"), "Console");
    assert.equal(folderOf("CONINX"), "CONINX");
    assert.equal(folderOf("Con Air"), "Con Air");
    assert.equal(folderOf("COM10"), "COM10");
  });

  it("keeps a string suffix in the file name for long titles", () => {
    const gameTitle = "x".repeat(130);
    const first = resolveManualScreenshotPath("root", gameTitle, capturedAt);
    const fallback = resolveManualScreenshotPath(
      "root",
      gameTitle,
      capturedAt,
      "unique"
    );

    assert.notEqual(fallback, first);
    assert.equal(path.dirname(fallback), path.dirname(first));
    assert.match(path.basename(fallback), /-unique\.jpeg$/);
  });
});
