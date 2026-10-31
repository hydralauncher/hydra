import assert from "node:assert/strict";
import { it } from "node:test";

import {
  isRetroArchEmulationDeepLink,
  isRpcs3EmulationDeepLink,
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

it("opens the RPCS3 executable settings from a Big Picture deep link", () => {
  assert.equal(
    isRpcs3EmulationDeepLink("?tab=emulation&system=ps3&section=emulator"),
    true
  );
  assert.equal(
    isRpcs3EmulationDeepLink("?tab=emulation&system=retroarch"),
    false
  );
});
