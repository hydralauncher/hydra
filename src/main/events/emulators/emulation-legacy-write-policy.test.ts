import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmulationSavePlatform } from "@types";

import { assertLegacyEmulationSaveWriteAllowed } from "./emulation-legacy-write-policy.js";

const allPlatforms: EmulationSavePlatform[] = [
  "ps1",
  "ps2",
  "psp",
  "gamecube",
  "wii",
];

describe("separate emulation save API write policy", () => {
  it("blocks every migrated emulator through the current provider gate", () => {
    for (const platform of allPlatforms) {
      assert.throws(
        () => assertLegacyEmulationSaveWriteAllowed(platform),
        /cloud_save_legacy_read_only/
      );
    }
  });

  it("blocks direct upload and restore as each emulator switches to V2", () => {
    const v2Platform = "Sony PlayStation 2";
    const lookup = (_shop: string, platform?: string | null) =>
      platform === v2Platform ? ("rpcs3" as const) : null;

    assert.throws(
      () => assertLegacyEmulationSaveWriteAllowed("ps2", lookup),
      /cloud_save_legacy_read_only/
    );
    for (const platform of allPlatforms.filter((item) => item !== "ps2")) {
      assert.doesNotThrow(() =>
        assertLegacyEmulationSaveWriteAllowed(platform, lookup)
      );
    }
  });

  it("checks all separate API platforms against their LaunchBox provider", () => {
    const observed = new Map<EmulationSavePlatform, string>();
    for (const platform of allPlatforms) {
      assert.throws(
        () =>
          assertLegacyEmulationSaveWriteAllowed(
            platform,
            (_shop, launchboxPlatform) => {
              observed.set(platform, launchboxPlatform!);
              return "retroarch";
            }
          ),
        /cloud_save_legacy_read_only/
      );
    }
    assert.equal(observed.get("ps1"), "Sony PlayStation");
    assert.equal(observed.get("ps2"), "Sony PlayStation 2");
    assert.equal(observed.get("psp"), "Sony PlayStation Portable");
    assert.equal(observed.get("gamecube"), "Nintendo GameCube");
    assert.equal(observed.get("wii"), "Nintendo Wii");
  });

  it("keeps legacy writes available for platforms without a V2 provider", () => {
    for (const platform of allPlatforms) {
      assert.doesNotThrow(() =>
        assertLegacyEmulationSaveWriteAllowed(platform, () => null)
      );
    }
  });

  it("rejects an invalid platform passed directly over IPC", () => {
    assert.throws(
      () =>
        assertLegacyEmulationSaveWriteAllowed(
          undefined as unknown as EmulationSavePlatform
        ),
      /invalid_emulation_save_platform/
    );
  });
});
