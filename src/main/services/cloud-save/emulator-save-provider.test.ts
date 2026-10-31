import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { getEmulatorSaveProvider } from "./emulator-save-provider.js";

describe("emulator provider loading", () => {
  it("leaves Steam and unrelated LaunchBox games independent of emulator modules", () => {
    assert.equal(
      getEmulatorSaveProvider({ shop: "steam", platform: null } as Game),
      null
    );
    assert.equal(
      getEmulatorSaveProvider({
        shop: "launchbox",
        platform: "Sony PlayStation 2",
      } as Game),
      null
    );
    assert.equal(
      getEmulatorSaveProvider({
        shop: "launchbox",
        platform: "Sony PlayStation 3",
      } as Game),
      "rpcs3"
    );
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Sony PlayStation Portable",
      "Nintendo GameCube",
      "Nintendo Wii",
    ]) {
      assert.equal(
        getEmulatorSaveProvider({ shop: "launchbox", platform } as Game),
        null
      );
    }
    assert.equal(
      getEmulatorSaveProvider({
        shop: "launchbox",
        platform: "Atari 2600",
      } as Game),
      null
    );
  });
});
