import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LibraryGame } from "@types";
import { getOfficialStoreMembers } from "../../../../../../shared/official-store-options.js";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as categorySelectionModule from "./category-selection.ts";

const {
  getAvailableGameSettingsCategory,
  getCloudGameSettingsCategories,
  isEpicCloudSettingsAvailable,
  shouldInitializeGameSettingsCategory,
} = categorySelectionModule;

describe("game options category selection", () => {
  it("initializes when the modal opens", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: false, initialCategory: "general" },
        { visible: true, initialCategory: "general" }
      ),
      true
    );
  });

  it("initializes when the requested category changes while open", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: true, initialCategory: "general" },
        { visible: true, initialCategory: "assets" }
      ),
      true
    );
  });

  it("does not initialize again while the modal remains open", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: true, initialCategory: "general" },
        { visible: true, initialCategory: "general" }
      ),
      false
    );
  });

  it("preserves a manually selected category when availability changes", () => {
    assert.equal(
      getAvailableGameSettingsCategory("assets", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: false,
        showEpicCloudSettings: false,
        showDownloadSettings: true,
      }),
      "assets"
    );
  });

  it("falls back when the selected cloud category is unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: false,
        showLegacyCloudSaveSettings: true,
        showEpicCloudSettings: false,
        showDownloadSettings: true,
      }),
      "general"
    );
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud_legacy", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: false,
        showEpicCloudSettings: false,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back when cloud access is lost", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "paywall",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: true,
        showEpicCloudSettings: false,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back when downloads are unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("downloads", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: true,
        showEpicCloudSettings: false,
        showDownloadSettings: false,
      }),
      "general"
    );
  });

  it("opens Epic independently of Hydra Cloud access", () => {
    for (const cloudSaveAccessAction of [
      "paywall",
      "sign-in",
      "open",
    ] as const) {
      assert.equal(
        getAvailableGameSettingsCategory("epic_cloud", {
          cloudSaveAccessAction,
          showCloudSaveV2Settings: true,
          showLegacyCloudSaveSettings: true,
          showEpicCloudSettings: true,
          showDownloadSettings: true,
        }),
        "epic_cloud"
      );
    }
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: false, initialCategory: "epic_cloud" },
        { visible: true, initialCategory: "epic_cloud" }
      ),
      true
    );
  });

  it("places Epic after active Hydra Cloud and before legacy archives", () => {
    const availability = {
      cloudSaveAccessAction: "open" as const,
      showCloudSaveV2Settings: true,
      showLegacyCloudSaveSettings: true,
      showEpicCloudSettings: true,
      showDownloadSettings: true,
    };
    assert.deepEqual(getCloudGameSettingsCategories(availability, "archive"), [
      "hydra_cloud",
      "epic_cloud",
      "hydra_cloud_legacy",
    ]);
    assert.deepEqual(
      getCloudGameSettingsCategories(
        { ...availability, showCloudSaveV2Settings: false },
        "active"
      ),
      ["hydra_cloud_legacy", "epic_cloud"]
    );
    assert.deepEqual(
      getCloudGameSettingsCategories(
        { ...availability, cloudSaveAccessAction: "sign-in" },
        "archive"
      ),
      ["epic_cloud"]
    );
  });

  it("returns to General when the Epic category is no longer available", () => {
    assert.equal(
      getAvailableGameSettingsCategory("epic_cloud", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: true,
        showEpicCloudSettings: false,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("uses the real imported Epic member when the catalogue presents Steam", () => {
    const epic = {
      shop: "epic",
      objectId: "namespace:executable",
      catalogueGame: { shop: "steam", objectId: "123" },
      hasActiveEpicImport: true,
      epicInstallation: {
        artifactId: "artifact",
        platform: "Windows",
        owner: {
          userId: "user",
          epicAccountId: "account",
          environment: "staging",
        },
      },
      isDeleted: false,
    } as LibraryGame;
    const steam = { shop: "steam", hasActiveSteamImport: true } as LibraryGame;
    const bridge = {
      getEpicCloudSaveState: () => {},
      setEpicCloudSaveSettings: () => {},
      syncEpicCloudSaves: () => {},
      resolveEpicCloudSaveConflict: () => {},
      onEpicCloudSaveStateChanged: () => {},
      onEpicConnectionChanged: () => {},
    };
    const member = getOfficialStoreMembers([steam, epic]).epic;
    assert.equal(member, epic);
    // Remote verification is deliberately irrelevant to category visibility.
    assert.equal(isEpicCloudSettingsAvailable(member, bridge), true);
    assert.equal(isEpicCloudSettingsAvailable(steam, bridge), false);
    assert.equal(
      isEpicCloudSettingsAvailable(
        { ...epic, hasActiveEpicImport: false },
        bridge
      ),
      false
    );
    assert.equal(
      isEpicCloudSettingsAvailable(
        { ...epic, epicInstallation: undefined },
        bridge
      ),
      false
    );
    assert.equal(
      isEpicCloudSettingsAvailable(epic, {
        ...bridge,
        syncEpicCloudSaves: undefined,
      }),
      false
    );
    assert.equal(
      isEpicCloudSettingsAvailable(epic, {
        ...bridge,
        onEpicCloudSaveStateChanged: undefined,
      }),
      false
    );
  });
});
