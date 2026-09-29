import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmulationSavePlatform } from "@types";

import {
  getEmulationSaveMenuMode,
  launchboxPlatformByEmulationSavePlatform,
} from "./emulation-save-v2-platform.js";

const platforms: EmulationSavePlatform[] = [
  "ps1",
  "ps2",
  "psp",
  "gamecube",
  "wii",
];

describe("emulation cloud archive menu", () => {
  it("shows archive actions for all currently migrated emulators", () => {
    for (const platform of platforms) {
      assert.equal(getEmulationSaveMenuMode(platform), "archive");
    }
  });

  it("shows download/delete only after a platform has a V2 provider", () => {
    for (const platform of platforms) {
      assert.equal(
        getEmulationSaveMenuMode(platform, (_shop, candidate) =>
          candidate === launchboxPlatformByEmulationSavePlatform[platform]
            ? "retroarch"
            : null
        ),
        "archive"
      );
    }
  });

  it("keeps restore available on platforms still using the legacy API", () => {
    for (const platform of platforms) {
      assert.equal(
        getEmulationSaveMenuMode(platform, () => null),
        "active"
      );
    }
  });
});
