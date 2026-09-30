import assert from "node:assert/strict";
import { it } from "node:test";
import { hasCloudSaveExecutableSelection } from "../../../../../shared/cloud-save-emulator-provider.js";

import {
  getCloudSavePanelMode,
  getRpcs3ConfigWarningKey,
  RPCS3_CONFIG_SETTINGS_URL,
  shouldShowRpcs3IdentityCard,
} from "./rpcs3-config-presentation.js";

it("shows the specific RPCS3 configuration warning and links to PlayStation 3 settings", () => {
  assert.equal(
    getRpcs3ConfigWarningKey("missing"),
    "cloud_save_v2_rpcs3_config_missing"
  );
  assert.equal(
    getRpcs3ConfigWarningKey("ambiguous"),
    "cloud_save_v2_rpcs3_config_ambiguous"
  );
  assert.equal(
    getRpcs3ConfigWarningKey("invalid-selection"),
    "cloud_save_v2_rpcs3_config_invalid-selection"
  );
  assert.equal(getRpcs3ConfigWarningKey("ready"), null);
  assert.equal(getRpcs3ConfigWarningKey(null), null);
  assert.equal(
    RPCS3_CONFIG_SETTINGS_URL,
    "/settings?tab=emulation&system=ps3&section=emulator"
  );
});

it("replaces sync with a disc identity warning in both PS3 modals", () => {
  const mismatch = {
    status: "mismatch" as const,
    path: "/games/minecraft",
    titleId: "NPUB31419",
  };
  assert.equal(shouldShowRpcs3IdentityCard(true, mismatch, false, false), true);
  assert.equal(shouldShowRpcs3IdentityCard(true, mismatch, false, true), false);
  assert.equal(
    shouldShowRpcs3IdentityCard(false, mismatch, false, false),
    false
  );
  assert.equal(
    shouldShowRpcs3IdentityCard(
      true,
      { status: "missing", path: null, titleId: null },
      false,
      false
    ),
    false
  );
  assert.equal(shouldShowRpcs3IdentityCard(true, null, true, false), true);
});

it("uses the RPCS3 setup card instead of a disabled sync action", () => {
  assert.equal(
    getCloudSavePanelMode(true, "not-configured", "content", false),
    "rpcs3-config"
  );
  assert.equal(
    getCloudSavePanelMode(true, "ambiguous", "skeleton", false),
    "rpcs3-config"
  );
  assert.equal(
    getCloudSavePanelMode(false, "not-configured", "content", false),
    "missing-executable"
  );
  assert.equal(
    getCloudSavePanelMode(true, "ready", "content", false),
    "content"
  );
  assert.equal(getCloudSavePanelMode(true, null, "content", false), "content");
  assert.equal(
    getCloudSavePanelMode(true, "missing", "content", true),
    "content"
  );
});

it("asks for a PS3 disc before showing an RPCS3 configuration warning", () => {
  const game = {
    shop: "launchbox" as const,
    platform: "PlayStation 3",
    discs: [],
    selectedDiscPath: null,
  };

  assert.equal(
    getCloudSavePanelMode(
      hasCloudSaveExecutableSelection(game),
      "not-configured",
      "content",
      false
    ),
    "missing-executable"
  );
});
