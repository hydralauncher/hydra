import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";
import { assertLegacyCloudSaveWriteAllowed } from "./legacy-cloud-save-policy.js";

const game = (shop: Game["shop"], platform: string) =>
  ({ shop, platform }) as Game;

describe("legacy cloud save write policy", () => {
  it("blocks legacy upload and sync settings for V2 emulator games", () => {
    for (const platform of [
      "Sony PlayStation 3",
      "Nintendo Entertainment System",
      "Super Nintendo Entertainment System",
      "Nintendo 64",
      "Nintendo Game Boy",
      "Nintendo Game Boy Color",
      "Nintendo Game Boy Advance",
    ]) {
      assert.throws(
        () => assertLegacyCloudSaveWriteAllowed(game("launchbox", platform)),
        /cloud_save_legacy_read_only/
      );
    }
  });

  it("keeps Steam and other emulators on their existing paths", () => {
    assert.doesNotThrow(() =>
      assertLegacyCloudSaveWriteAllowed(game("steam", "Sony PlayStation 3"))
    );
    assert.doesNotThrow(() =>
      assertLegacyCloudSaveWriteAllowed(game("launchbox", "Atari 2600"))
    );
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Sony PlayStation Portable",
      "Nintendo GameCube",
      "Nintendo Wii",
    ]) {
      assert.doesNotThrow(() =>
        assertLegacyCloudSaveWriteAllowed(game("launchbox", platform))
      );
    }
    assert.doesNotThrow(() => assertLegacyCloudSaveWriteAllowed(null));
  });
});
