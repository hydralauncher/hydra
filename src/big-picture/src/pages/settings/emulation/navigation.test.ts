import assert from "node:assert/strict";
import { it } from "node:test";

import {
  isRetroArchEmulationDeepLink,
  getEmulatorDetailDeepLinkSystem,
} from "./navigation.js";

it("opens the RetroArch executable settings from a Big Picture deep link", () => {
  assert.equal(
    isRetroArchEmulationDeepLink(
      "?tab=emulation&system=retroarch&section=emulator"
    ),
    true
  );
  assert.equal(
    isRetroArchEmulationDeepLink("?tab=emulation&system=ps3"),
    false
  );
  assert.equal(
    isRetroArchEmulationDeepLink("?tab=general&system=retroarch"),
    false
  );
});

it("opens the RPCS3 and shadPS4 settings from a Big Picture deep link", () => {
  assert.equal(
    getEmulatorDetailDeepLinkSystem(
      "?tab=emulation&system=ps3&section=emulator"
    ),
    "ps3"
  );
  assert.equal(
    getEmulatorDetailDeepLinkSystem(
      "?tab=emulation&system=ps4&section=emulator"
    ),
    "ps4"
  );
  assert.equal(
    getEmulatorDetailDeepLinkSystem("?tab=emulation&system=retroarch"),
    null
  );
  assert.equal(
    getEmulatorDetailDeepLinkSystem("?tab=general&system=ps4"),
    null
  );
});
