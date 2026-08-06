import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as visibilityModule from "./cloud-save-visibility.ts";

const { getCloudSaveVisibility } = visibilityModule;

describe("cloud save visibility", () => {
  it("uses V2 for Steam and keeps legacy saves as an archive", () => {
    assert.deepEqual(getCloudSaveVisibility("steam"), {
      hero: "v2",
      settings: {
        showV2: true,
        showLegacy: true,
        legacyPurpose: "archive",
      },
    });
  });

  it("keeps legacy cloud saves for emulated games", () => {
    assert.deepEqual(getCloudSaveVisibility("launchbox"), {
      hero: "legacy",
      settings: {
        showV2: false,
        showLegacy: true,
        legacyPurpose: "active",
      },
    });
  });

  it("preserves the main-branch behavior for custom games", () => {
    assert.deepEqual(getCloudSaveVisibility("custom"), {
      hero: null,
      settings: {
        showV2: false,
        showLegacy: true,
        legacyPurpose: "active",
      },
    });
  });
});
