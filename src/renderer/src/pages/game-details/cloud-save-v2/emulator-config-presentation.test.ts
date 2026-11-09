import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import {
  DISC_CLOUD_SAVE_EMULATOR_PROVIDERS,
  hasCloudSaveExecutableSelection,
} from "../../../../../shared/cloud-save-emulator-provider.js";

import {
  getCloudSavePanelMode,
  getEmulatorConfigWarningKey,
  emulatorConfigSettingsUrl,
  shouldShowDiscIdentityCard,
  discIdentityKey,
} from "./emulator-config-presentation.js";

it("has every disc provider string in the English locale", () => {
  const { game_details: strings } = JSON.parse(
    readFileSync(
      new URL("../../../../../locales/en/translation.json", import.meta.url),
      "utf8"
    )
  ) as { game_details: Record<string, string> };
  const configStatuses = [
    "not-configured",
    "missing",
    "ambiguous",
    "invalid-selection",
    "error",
  ] as const;
  const identitySuffixes = [
    "title",
    "unverified",
    "mismatch",
    "stale-sku",
    "catalogue-unavailable",
    "remote",
    "edit_discs",
  ];

  for (const provider of DISC_CLOUD_SAVE_EMULATOR_PROVIDERS) {
    const keys = [
      `cloud_save_v2_${provider}_config_required_title`,
      `cloud_save_v2_${provider}_config_open_settings`,
      ...configStatuses.map(
        (status) => getEmulatorConfigWarningKey(provider, status)!
      ),
      ...identitySuffixes.map((suffix) => discIdentityKey(provider, suffix)),
    ];
    for (const key of keys) {
      assert.ok(strings[key], `missing en string ${key}`);
    }
  }
});

it("shows the specific RPCS3 configuration warning and links to PlayStation 3 settings", () => {
  assert.equal(
    getEmulatorConfigWarningKey("rpcs3", "missing"),
    "cloud_save_v2_rpcs3_config_missing"
  );
  assert.equal(
    getEmulatorConfigWarningKey("rpcs3", "ambiguous"),
    "cloud_save_v2_rpcs3_config_ambiguous"
  );
  assert.equal(
    getEmulatorConfigWarningKey("rpcs3", "invalid-selection"),
    "cloud_save_v2_rpcs3_config_invalid-selection"
  );
  assert.equal(getEmulatorConfigWarningKey("rpcs3", "ready"), null);
  assert.equal(getEmulatorConfigWarningKey("rpcs3", "checking"), null);
  assert.equal(
    getEmulatorConfigWarningKey("rpcs3", "error"),
    "cloud_save_v2_rpcs3_config_error"
  );
  assert.equal(getEmulatorConfigWarningKey("rpcs3", null), null);
  assert.equal(
    emulatorConfigSettingsUrl("rpcs3"),
    "/settings?tab=emulation&system=ps3&section=emulator"
  );
});

it("replaces sync with a disc identity warning in both PS3 modals", () => {
  const mismatch = {
    status: "mismatch" as const,
    path: "/games/minecraft",
    titleId: "NPUB31419",
  };
  assert.equal(shouldShowDiscIdentityCard(true, mismatch, false, false), true);
  assert.equal(shouldShowDiscIdentityCard(true, mismatch, false, true), false);
  assert.equal(
    shouldShowDiscIdentityCard(false, mismatch, false, false),
    false
  );
  assert.equal(
    shouldShowDiscIdentityCard(
      true,
      { status: "missing", path: null, titleId: null },
      false,
      false
    ),
    false
  );
  assert.equal(shouldShowDiscIdentityCard(true, null, true, false), true);
});

it("uses the RPCS3 setup card instead of a disabled sync action", () => {
  assert.equal(
    getCloudSavePanelMode(true, "not-configured", "content", false),
    "emulator-config"
  );
  assert.equal(
    getCloudSavePanelMode(true, "ambiguous", "skeleton", false),
    "emulator-config"
  );
  assert.equal(
    getCloudSavePanelMode(false, "not-configured", "content", false),
    "emulator-config"
  );
  assert.equal(
    getCloudSavePanelMode(false, "ambiguous", "content", false),
    "emulator-config"
  );
  assert.equal(
    getCloudSavePanelMode(true, "ready", "content", false),
    "content"
  );
  assert.equal(getCloudSavePanelMode(true, null, "content", false), "content");
  assert.equal(
    getCloudSavePanelMode(false, "ready", "content", false),
    "missing-executable"
  );
  assert.equal(
    getCloudSavePanelMode(true, "missing", "content", true),
    "content"
  );
});

it("checks emulator before ROM or disc and does not show a snapshot while blocked", () => {
  assert.equal(
    getCloudSavePanelMode(false, null, "content", false, "missing"),
    "retroarch-config"
  );
  for (const status of ["missing", "invalid", "error"] as const) {
    assert.equal(
      getCloudSavePanelMode(false, null, "content", false, status),
      "retroarch-config"
    );
  }
  assert.equal(
    getCloudSavePanelMode(false, null, "content", false, "checking"),
    "skeleton"
  );
  assert.equal(
    getCloudSavePanelMode(false, "checking", "content", false),
    "skeleton"
  );
  assert.equal(
    getCloudSavePanelMode(false, "error", "content", false),
    "emulator-config"
  );
  assert.equal(
    getCloudSavePanelMode(false, null, "content", false, "ready"),
    "missing-executable"
  );
  assert.equal(
    getCloudSavePanelMode(true, null, "content", true, "missing"),
    "content"
  );
});

it("asks for RPCS3 setup before a PS3 disc, then asks for the disc", () => {
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
    "emulator-config"
  );
  assert.equal(
    getCloudSavePanelMode(
      hasCloudSaveExecutableSelection(game),
      "ready",
      "content",
      false
    ),
    "missing-executable"
  );
});

it("keeps non emulator games on their existing media and snapshot paths", () => {
  assert.equal(
    getCloudSavePanelMode(false, null, "content", false),
    "missing-executable"
  );
  assert.equal(getCloudSavePanelMode(true, null, "content", false), "content");
});
