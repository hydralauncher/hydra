import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isExecutableNameExpectedForBinary } from "./is-executable-name-expected.ts";
import { KNOWN_BINARIES } from "./known-binaries.ts";

describe("isExecutableNameExpectedForBinary", () => {
  const dolphin = { binary: "dolphin" };

  it("rejects KDE Dolphin as Dolphin Emulator on Linux", () => {
    assert.equal(KNOWN_BINARIES.dolphin.linuxNames.includes("dolphin"), false);
    assert.equal(
      isExecutableNameExpectedForBinary("/usr/bin/dolphin", dolphin, "linux"),
      false
    );
  });

  it("accepts Dolphin Emulator Linux executable names", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/usr/bin/dolphin-emu",
        dolphin,
        "linux"
      ),
      true
    );
    assert.equal(
      isExecutableNameExpectedForBinary(
        "/home/user/Applications/Dolphin-2606-x86_64.AppImage",
        dolphin,
        "linux"
      ),
      true
    );
  });

  it("keeps the Dolphin executable name valid on other platforms", () => {
    assert.equal(
      isExecutableNameExpectedForBinary(
        String.raw`C:\\Dolphin\\Dolphin.exe`,
        dolphin,
        "win32"
      ),
      true
    );
  });
});
