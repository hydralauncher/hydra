import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRetroArchSouvenirAppendConfig,
  getCfgLine,
  getCfgValue,
  restoreCfgLine,
  restoreRetroArchSouvenirConfigValues,
  setCfgValue,
  setRetroArchSouvenirConfigValues,
  usesRetroArchContentScreenshotDirectory,
} from "./retroarch-souvenir-config-value.js";

const KEY = "cheevos_auto_screenshot";
const SCREENSHOT_DIRECTORY_KEY = "screenshot_directory";

describe("RetroArch souvenir configuration", () => {
  it("builds a session-only append configuration", () => {
    assert.equal(
      buildRetroArchSouvenirAppendConfig("/tmp/hydra-souvenirs"),
      'cheevos_auto_screenshot = "true"\n' +
        'screenshot_directory = "/tmp/hydra-souvenirs"\n' +
        'config_save_on_exit = "false"\n'
    );
  });

  it("uses the content directory for default screenshot configurations", () => {
    assert.equal(
      usesRetroArchContentScreenshotDirectory(
        getCfgValue(
          `${SCREENSHOT_DIRECTORY_KEY} = "default"\n`,
          SCREENSHOT_DIRECTORY_KEY
        )
      ),
      true
    );
    assert.equal(
      usesRetroArchContentScreenshotDirectory(
        getCfgValue('video_fullscreen = "true"\n', SCREENSHOT_DIRECTORY_KEY)
      ),
      true
    );
    assert.equal(
      usesRetroArchContentScreenshotDirectory(
        getCfgValue(
          `${SCREENSHOT_DIRECTORY_KEY} = "/user/screenshots"\n`,
          SCREENSHOT_DIRECTORY_KEY
        )
      ),
      false
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

    const enabled = setRetroArchSouvenirConfigValues(
      original,
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
    const enabled = setRetroArchSouvenirConfigValues(
      original,
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
