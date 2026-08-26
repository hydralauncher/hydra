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
  it("offers an all-files entry on every platform", () => {
    for (const platform of ["win32", "linux", "darwin"]) {
      const filters = getGameExecutableFilters(platform, {
        executable: "Executable",
        allFiles: "All files",
      });

      assert.ok(
        filters.some((filter) => filter.extensions.includes("*")),
        `missing all-files filter on ${platform}`
      );
    }
  });
});
