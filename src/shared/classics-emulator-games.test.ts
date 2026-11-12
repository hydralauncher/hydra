import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isClassicsGameForEmulator } from "./classics-emulator-games.js";

const classics = (platform: string, patch = {}) => ({
  shop: "launchbox",
  platform,
  ...patch,
});

describe("classics emulator games", () => {
  it("matches standalone emulator games by system", () => {
    const pcsx2 = { kind: "emulator", system: "ps2" } as const;

    assert.equal(
      isClassicsGameForEmulator(classics("Sony Playstation 2"), pcsx2),
      true
    );
    assert.equal(
      isClassicsGameForEmulator(classics("Sony Playstation"), pcsx2),
      false
    );
    assert.equal(
      isClassicsGameForEmulator(
        { shop: "steam", platform: "Sony Playstation 2" },
        pcsx2
      ),
      false
    );
  });

  it("matches every RetroArch platform", () => {
    const retroarch = { kind: "retroarch" } as const;

    for (const platform of [
      "Nintendo Entertainment System",
      "Super Nintendo Entertainment System",
      "Nintendo 64",
      "Nintendo Game Boy",
      "Nintendo Game Boy Color",
      "Nintendo Game Boy Advance",
    ]) {
      assert.equal(
        isClassicsGameForEmulator(classics(platform), retroarch),
        true
      );
    }
    assert.equal(
      isClassicsGameForEmulator(classics("Sony Playstation 2"), retroarch),
      false
    );
  });

  it("skips games already removed from the library", () => {
    assert.equal(
      isClassicsGameForEmulator(classics("Nintendo 64", { isDeleted: true }), {
        kind: "retroarch",
      }),
      false
    );
  });
});
