import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGameExecutableFilters, isGameExecutable } from "./constants.js";

describe("isGameExecutable", () => {
  it("accepts executables on windows and rejects ROMs", () => {
    assert.equal(isGameExecutable("C:\\Games\\game.exe", "win32"), true);
    assert.equal(isGameExecutable("C:\\Games\\launch.BAT", "win32"), true);
    assert.equal(isGameExecutable("C:\\Games\\setup.msi", "win32"), true);
    assert.equal(isGameExecutable("C:\\ROMs\\Daxter.iso", "win32"), false);
    assert.equal(isGameExecutable("C:\\ROMs\\Daxter.cso", "win32"), false);
  });

  it("treats extensionless files as executables", () => {
    assert.equal(isGameExecutable("/usr/bin/PPSSPPSDL", "linux"), true);
    assert.equal(isGameExecutable("/home/alex/Game.AppImage", "linux"), true);
    assert.equal(
      isGameExecutable("/home/alex/Daxter (USA).iso", "linux"),
      false
    );
  });

  it("ignores dots in parent directories", () => {
    assert.equal(isGameExecutable("/home/alex/my.roms/Celeste", "linux"), true);
  });

  it("accepts app bundles on macOS", () => {
    assert.equal(isGameExecutable("/Applications/PPSSPP.app", "darwin"), true);
    assert.equal(isGameExecutable("/roms/Daxter.cso", "darwin"), false);
  });
});

describe("getGameExecutableFilters", () => {
  const offersAllFiles = (platform: string) =>
    getGameExecutableFilters(platform, {
      executable: "Executable",
      allFiles: "All files",
    }).some((filter) => filter.extensions.includes("*"));

  it("offers an all-files entry only on linux", () => {
    assert.equal(offersAllFiles("linux"), true);
    assert.equal(offersAllFiles("win32"), false);
    assert.equal(offersAllFiles("darwin"), false);
  });
});
