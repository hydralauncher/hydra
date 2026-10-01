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

  it("shows V2 for eligible LaunchBox emulators only", () => {
    assert.equal(shouldShowCloudSaveV2Tab("launchbox", true, true), false);
    assert.equal(
      shouldShowCloudSaveV2Tab("launchbox", true, true, "Sony PlayStation 3"),
      true
    );
    assert.equal(
      shouldShowCloudSaveV2Tab(
        "launchbox",
        true,
        true,
        "Nintendo Game Boy Advance"
      ),
      true
    );
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Sony PlayStation Portable",
      "Nintendo GameCube",
      "Nintendo Wii",
    ]) {
      assert.equal(
        shouldShowCloudSaveV2Tab("launchbox", true, true, platform),
        false
      );
    }
    assert.equal(
      shouldShowCloudSaveV2Tab("launchbox", true, true, "Atari 2600"),
      false
    );
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
    assert.equal(
      shouldShowLegacyCloudSaveTab(
        "launchbox",
        true,
        true,
        "Sony PlayStation 3"
      ),
      false
    );
    assert.equal(
      shouldShowLegacyCloudSaveTab(
        "launchbox",
        true,
        true,
        "Nintendo Game Boy Advance"
      ),
      false
    );
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Sony PlayStation Portable",
      "Nintendo GameCube",
      "Nintendo Wii",
    ]) {
      assert.equal(
        shouldShowLegacyCloudSaveTab("launchbox", true, true, platform),
        true
      );
    }
    assert.equal(
      shouldShowLegacyCloudSaveTab("launchbox", true, true, "Atari 2600"),
      true
    );
  });

  it("preserves the current custom-game behavior", () => {
    assert.equal(shouldShowLegacyCloudSaveTab("custom", true, true), true);
  });

  it("keeps the tab hidden without an account or subscription", () => {
    assert.equal(shouldShowLegacyCloudSaveTab("launchbox", false, true), false);
    assert.equal(shouldShowLegacyCloudSaveTab("launchbox", true, false), false);
  });
});
