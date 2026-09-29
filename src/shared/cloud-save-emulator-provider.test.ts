import assert from "node:assert/strict";
import { it } from "node:test";

import {
  canSelectCloudSaveCustomFile,
  isCloudSaveV2Eligible,
} from "./cloud-save-emulator-provider.js";

it("offers Add save file only for LaunchBox emulator V2 games", () => {
  assert.equal(canSelectCloudSaveCustomFile("steam"), false);
  assert.equal(canSelectCloudSaveCustomFile("steam", "Super Nintendo"), false);
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "Unsupported Platform"),
    false
  );
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "Super Nintendo"),
    true
  );
  assert.equal(
    canSelectCloudSaveCustomFile("launchbox", "PlayStation 3"),
    true
  );
  for (const platform of [
    "Sony PlayStation",
    "Sony PlayStation 2",
    "Sony PlayStation Portable",
    "Nintendo GameCube",
    "Nintendo Wii",
  ]) {
    assert.equal(canSelectCloudSaveCustomFile("launchbox", platform), false);
    assert.equal(isCloudSaveV2Eligible("launchbox", platform), false);
  }
});
