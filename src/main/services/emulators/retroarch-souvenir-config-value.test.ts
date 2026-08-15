import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getCfgLine,
  restoreCfgLine,
  setCfgValue,
} from "./retroarch-souvenir-config-value.js";

const KEY = "cheevos_auto_screenshot";

describe("RetroArch souvenir configuration", () => {
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
});
