import assert from "node:assert/strict";
import test from "node:test";
import { epicManagedInstallationSupport } from "./managed-platform.js";

test("managed install supports Windows and Linux x64 independently of account import", () => {
  assert.deepEqual(epicManagedInstallationSupport("linux", "x64"), {
    available: true,
  });
  assert.deepEqual(epicManagedInstallationSupport("win32", "arm64"), {
    available: true,
  });
  assert.deepEqual(epicManagedInstallationSupport("linux", "arm64"), {
    available: false,
    reason: "unsupported-architecture",
  });
  assert.deepEqual(epicManagedInstallationSupport("darwin", "x64"), {
    available: false,
    reason: "unsupported-platform",
  });
});
