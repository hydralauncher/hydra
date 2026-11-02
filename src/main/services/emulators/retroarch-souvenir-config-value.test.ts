import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRetroArchAchievementLogLaunchArguments,
  getCfgLine,
  restoreCfgLine,
  restoreRetroArchSouvenirConfigValues,
  setCfgValue,
} from "./retroarch-souvenir-config-value.js";

const KEY = "cheevos_auto_screenshot";
const SCREENSHOT_DIRECTORY_KEY = "screenshot_directory";

describe("RetroArch souvenir configuration", () => {
  it("builds launch arguments that write a verbose session log", () => {
    assert.deepEqual(
      buildRetroArchAchievementLogLaunchArguments("/tmp/hydra/retroarch.log"),
      ["--log-file", "/tmp/hydra/retroarch.log", "--verbose"]
    );
  });

  it("restores a user value that was disabled before souvenirs", () => {
    const original = `${KEY} = "false"\nvideo_fullscreen = "true"\n`;
    const originalLine = getCfgLine(original, KEY);
    const enabled = setCfgValue(original, KEY, "true");

    assert.equal(restoreCfgLine(enabled, KEY, originalLine), original);
  });

  it("keeps a value that the user had already enabled", () => {
    const original = `${KEY} = "true"\n`;
    const originalLine = getCfgLine(original, KEY);

    assert.equal(
      restoreCfgLine(setCfgValue(original, KEY, "true"), KEY, originalLine),
      original
    );
  });

  it("removes the setting when Hydra originally added it", () => {
    const original = `video_fullscreen = "true"\n`;
    const enabled = setCfgValue(original, KEY, "true");

    assert.equal(restoreCfgLine(enabled, KEY, null), original);
  });

  it("sets and restores the dedicated screenshot directory", () => {
    const original = `${KEY} = "false"\n${SCREENSHOT_DIRECTORY_KEY} = "default"\n`;
    const originalAutoScreenshotLine = getCfgLine(original, KEY);
    const originalScreenshotDirectoryLine = getCfgLine(
      original,
      SCREENSHOT_DIRECTORY_KEY
    );

    const enabled = setCfgValue(
      setCfgValue(original, KEY, "true"),
      SCREENSHOT_DIRECTORY_KEY,
      "/hydra/retroarch-screenshots"
    );

    assert.match(enabled, /cheevos_auto_screenshot = "true"/);
    assert.match(
      enabled,
      /screenshot_directory = "\/hydra\/retroarch-screenshots"/
    );
    assert.equal(
      restoreRetroArchSouvenirConfigValues(
        enabled,
        originalAutoScreenshotLine,
        originalScreenshotDirectoryLine
      ),
      original
    );
  });

  it("removes both settings when Hydra originally added them", () => {
    const original = `video_fullscreen = "true"\n`;
    const enabled = setCfgValue(
      setCfgValue(original, KEY, "true"),
      SCREENSHOT_DIRECTORY_KEY,
      "/hydra/retroarch-screenshots"
    );

    assert.equal(
      restoreRetroArchSouvenirConfigValues(enabled, null, null),
      original
    );
  });

  it("leaves the screenshot directory untouched for legacy backups", () => {
    const configured = `${KEY} = "true"\n${SCREENSHOT_DIRECTORY_KEY} = "/user/screenshots"\n`;

    assert.equal(
      restoreRetroArchSouvenirConfigValues(configured, `${KEY} = "false"`),
      `${KEY} = "false"\n${SCREENSHOT_DIRECTORY_KEY} = "/user/screenshots"\n`
    );
  });
});
