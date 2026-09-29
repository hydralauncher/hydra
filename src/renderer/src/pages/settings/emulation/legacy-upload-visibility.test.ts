import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmulationSavePlatform } from "@types";

import { canUploadLegacyEmulationSave } from "./legacy-upload-visibility.js";

describe("legacy emulator upload controls", () => {
  it("hides uploads on every platform already migrated to V2", () => {
    for (const platform of [
      "ps1",
      "ps2",
      "psp",
      "gamecube",
      "wii",
    ] satisfies EmulationSavePlatform[]) {
      assert.equal(canUploadLegacyEmulationSave(platform, true), false);
    }
  });

  it("does not show uploads without a subscription", () => {
    assert.equal(canUploadLegacyEmulationSave("ps1", false), false);
  });

  it("preserves uploads for a platform that still uses the legacy API", () => {
    const legacyMode = () => "active" as const;
    assert.equal(canUploadLegacyEmulationSave("ps1", true, legacyMode), true);
    assert.equal(canUploadLegacyEmulationSave("ps1", false, legacyMode), false);
  });
});
