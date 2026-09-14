import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as visibilityModule from "./cloud-tab-visibility.ts";

const { shouldShowCloudSaveV2Tab, shouldShowLegacyCloudSaveTab } =
  visibilityModule;

describe("Big Picture cloud save V2 tab visibility", () => {
  it("shows the V2 tab for subscribed Steam users", () => {
    assert.equal(shouldShowCloudSaveV2Tab("steam", true, true), true);
  });

  it("hides the V2 tab without an account or subscription", () => {
    assert.equal(shouldShowCloudSaveV2Tab("steam", false, true), false);
    assert.equal(shouldShowCloudSaveV2Tab("steam", true, false), false);
  });

  it("never shows the V2 tab for non-Steam games", () => {
    assert.equal(shouldShowCloudSaveV2Tab("launchbox", true, true), false);
    assert.equal(shouldShowCloudSaveV2Tab("custom", true, true), false);
  });
});

describe("Big Picture legacy cloud save tab visibility", () => {
  it("hides the legacy tab for Steam regardless of subscription", () => {
    assert.equal(shouldShowLegacyCloudSaveTab("steam", true, true), false);
    assert.equal(shouldShowLegacyCloudSaveTab("steam", true, false), false);
  });

  it("keeps the legacy tab for subscribed Launchbox users", () => {
    assert.equal(shouldShowLegacyCloudSaveTab("launchbox", true, true), true);
  });

  it("preserves the current custom-game behavior", () => {
    assert.equal(shouldShowLegacyCloudSaveTab("custom", true, true), true);
  });

  it("keeps the tab hidden without an account or subscription", () => {
    assert.equal(shouldShowLegacyCloudSaveTab("launchbox", false, true), false);
    assert.equal(shouldShowLegacyCloudSaveTab("launchbox", true, false), false);
  });
});
