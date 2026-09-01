import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KNOWN_BINARIES } from "./known-binaries.ts";
import { isEmulatorVersionProbeEnabled } from "./emulator-version-probe.ts";

describe("isEmulatorVersionProbeEnabled", () => {
  it("does not launch PPSSPP to read its version on Windows", () => {
    assert.equal(
      isEmulatorVersionProbeEnabled(KNOWN_BINARIES.psp, "win32"),
      false
    );
  });

  it("keeps PPSSPP version probes enabled on supported platforms", () => {
    assert.equal(
      isEmulatorVersionProbeEnabled(KNOWN_BINARIES.psp, "linux"),
      true
    );
    assert.equal(
      isEmulatorVersionProbeEnabled(KNOWN_BINARIES.psp, "darwin"),
      true
    );
  });

  it("keeps other Windows emulator version probes enabled", () => {
    assert.equal(
      isEmulatorVersionProbeEnabled(KNOWN_BINARIES.dolphin, "win32"),
      true
    );
  });
});
