import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBareReleaseExecutable } from "./recompilation-executable.js";

describe("isBareReleaseExecutable", () => {
  it("copies a release named as the port's executable", () => {
    assert.equal(
      isBareReleaseExecutable("CrashBandicoot.exe", "CrashBandicoot.exe"),
      true
    );
    assert.equal(
      isBareReleaseExecutable("CrashBandicoot-Linux", "CrashBandicoot-Linux"),
      true
    );
  });

  it("extracts any other .exe, like a self-extracting release", () => {
    assert.equal(isBareReleaseExecutable("Port-Setup.exe", "Port.exe"), false);
    assert.equal(isBareReleaseExecutable("Port.exe", null), false);
  });

  it("extracts a versioned name that differs from the executable", () => {
    assert.equal(
      isBareReleaseExecutable(
        "CrashBandicoot-1.2-Linux",
        "CrashBandicoot-Linux"
      ),
      false
    );
  });
});
