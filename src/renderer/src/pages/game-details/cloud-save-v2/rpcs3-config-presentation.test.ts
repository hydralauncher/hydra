import assert from "node:assert/strict";
import { it } from "node:test";

import {
  getRpcs3ConfigWarningKey,
  RPCS3_CONFIG_SETTINGS_URL,
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
