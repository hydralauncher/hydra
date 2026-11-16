import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DARWIN_GAME_EXECUTABLE_EXTENSIONS,
  getGameExecutableFilters,
  LINUX_GAME_EXECUTABLE_EXTENSIONS,
  WINDOWS_GAME_EXECUTABLE_EXTENSIONS,
} from "./constants.js";

const labels = { executable: "Executable", allFiles: "All Files" };

describe("getGameExecutableFilters", () => {
  it("allows both .exe and .app plus all files on macOS", () => {
    const filters = getGameExecutableFilters("darwin", labels);

    assert.equal(filters.length, 2);
    assert.deepEqual(filters[0], {
      name: labels.executable,
      extensions: DARWIN_GAME_EXECUTABLE_EXTENSIONS,
    });
    assert.ok(filters[0].extensions.includes("exe"));
    assert.ok(filters[0].extensions.includes("app"));
    assert.ok(!filters[0].extensions.includes("lnk"));
    assert.deepEqual(filters[1], {
      name: labels.allFiles,
      extensions: ["*"],
    });
  });

  it("includes Windows and native extensions plus all files on Linux", () => {
    assert.deepEqual(getGameExecutableFilters("linux", labels), [
      { name: labels.executable, extensions: LINUX_GAME_EXECUTABLE_EXTENSIONS },
      { name: labels.allFiles, extensions: ["*"] },
    ]);
  });

  it("uses Windows executable extensions on win32", () => {
    assert.deepEqual(getGameExecutableFilters("win32", labels), [
      {
        name: labels.executable,
        extensions: WINDOWS_GAME_EXECUTABLE_EXTENSIONS,
      },
    ]);
  });
});
