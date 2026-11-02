import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveAchievementScreenshotsDirectory } from "./achievement-screenshots-directory-path.js";

const defaultScreenshotsPath = path.join(
  path.parse(process.cwd()).root,
  "default-screenshots"
);

describe("achievement screenshots directory", () => {
  it("uses the selected absolute directory", () => {
    const selectedPath = path.join(
      path.parse(process.cwd()).root,
      "screenshots"
    );

    assert.equal(
      resolveAchievementScreenshotsDirectory(
        selectedPath,
        defaultScreenshotsPath
      ),
      path.normalize(selectedPath)
    );
  });

  it("falls back to Hydra's screenshots directory", () => {
    assert.equal(
      resolveAchievementScreenshotsDirectory(undefined, defaultScreenshotsPath),
      defaultScreenshotsPath
    );
    assert.equal(
      resolveAchievementScreenshotsDirectory(
        "relative/screenshots",
        defaultScreenshotsPath
      ),
      defaultScreenshotsPath
    );
  });
});
