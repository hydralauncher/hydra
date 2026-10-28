import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { removeAppImageLibraryPath } from "./remove-appimage-library-path.ts";

const appDir = "/tmp/.mount_hydraXXXXXX";
const appRunEntry = `${appDir}/usr/lib`;
const trackedVariables = ["APPIMAGE", "APPDIR", "LD_LIBRARY_PATH"] as const;

describe("removeAppImageLibraryPath", () => {
  let savedVariables: Partial<Record<string, string>>;

  beforeEach(() => {
    savedVariables = Object.fromEntries(
      trackedVariables.map((name) => [name, process.env[name]])
    );
    process.env.APPIMAGE = "/home/user/Applications/hydralauncher.AppImage";
    process.env.APPDIR = appDir;
  });

  afterEach(() => {
    for (const name of trackedVariables) {
      const value = savedVariables[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("deletes LD_LIBRARY_PATH when AppRun added the only entry", () => {
    process.env.LD_LIBRARY_PATH = `${appRunEntry}:`;

    removeAppImageLibraryPath();

    assert.equal("LD_LIBRARY_PATH" in process.env, false);
  });

  it("keeps user entries around the AppRun one in order", () => {
    process.env.LD_LIBRARY_PATH = `/opt/first/lib:${appRunEntry}:/opt/second/lib`;

    removeAppImageLibraryPath();

    assert.equal(process.env.LD_LIBRARY_PATH, "/opt/first/lib:/opt/second/lib");
  });

  it("leaves LD_LIBRARY_PATH alone outside an AppImage", () => {
    for (const name of ["APPIMAGE", "APPDIR"] as const) {
      process.env.APPIMAGE = "/home/user/Applications/hydralauncher.AppImage";
      process.env.APPDIR = appDir;
      delete process.env[name];
      process.env.LD_LIBRARY_PATH = `${appRunEntry}:`;

      removeAppImageLibraryPath();

      assert.equal(process.env.LD_LIBRARY_PATH, `${appRunEntry}:`, name);
    }
  });
});
