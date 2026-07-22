import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getHydraExecutablePath } from "./hydra-executable-path.ts";

const originalAppImage = process.env.APPIMAGE;
const originalPortableExecutable = process.env.PORTABLE_EXECUTABLE_FILE;

const restoreEnvironmentVariable = (
  name: "APPIMAGE" | "PORTABLE_EXECUTABLE_FILE",
  value: string | undefined
) => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

afterEach(() => {
  restoreEnvironmentVariable("APPIMAGE", originalAppImage);
  restoreEnvironmentVariable(
    "PORTABLE_EXECUTABLE_FILE",
    originalPortableExecutable
  );
});

describe("getHydraExecutablePath", () => {
  it("prefers the stable AppImage path", () => {
    process.env.APPIMAGE = "/apps/Hydra.AppImage";
    process.env.PORTABLE_EXECUTABLE_FILE = "C:\\Hydra\\Hydra.exe";

    assert.equal(getHydraExecutablePath(), "/apps/Hydra.AppImage");
  });

  it("uses the portable executable when no AppImage is set", () => {
    delete process.env.APPIMAGE;
    process.env.PORTABLE_EXECUTABLE_FILE = "C:\\Hydra\\Hydra.exe";

    assert.equal(getHydraExecutablePath(), "C:\\Hydra\\Hydra.exe");
  });

  it("falls back to the current executable", () => {
    delete process.env.APPIMAGE;
    delete process.env.PORTABLE_EXECUTABLE_FILE;

    assert.equal(getHydraExecutablePath(), process.execPath);
  });
});
