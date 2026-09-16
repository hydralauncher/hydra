import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeGameExecutableCatalog } from "./game-executables-core.js";

const catalog = {
  "10": [
    { name: ">folder/game.exe", os: "win32" },
    { name: "folder/game", os: "linux" },
  ],
  "20": [{ name: "other/tool.exe", os: "win32" }],
};

describe("game executable catalogue", () => {
  it("normalizes Windows paths and keeps Windows executables", () => {
    assert.deepEqual(normalizeGameExecutableCatalog(catalog, "win32"), {
      "10": [{ name: "folder\\game.exe", exe: "game.exe" }],
      "20": [{ name: "other\\tool.exe", exe: "tool.exe" }],
    });
  });

  it("keeps native and compatibility executables on Linux", () => {
    assert.deepEqual(normalizeGameExecutableCatalog(catalog, "linux"), {
      "10": [
        { name: "folder/game.exe", exe: "game.exe" },
        { name: "folder/game", exe: "game" },
      ],
      "20": [{ name: "other/tool.exe", exe: "tool.exe" }],
    });
  });
});
