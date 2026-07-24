import assert from "node:assert/strict";
import test from "node:test";

import { hasWindowsVisibleProcessMatch } from "./windows-process-match.js";

test("matches an elevated game by executable name and visible window", () => {
  const result = hasWindowsVisibleProcessMatch(
    ["C:\\Games\\game.exe"],
    [{ name: "GAME.EXE", exe: null, pid: 42 }],
    (pid) => pid === 42
  );
  assert.equal(result, true);
});

test("rejects inaccessible background processes and name collisions", () => {
  assert.equal(
    hasWindowsVisibleProcessMatch(
      ["C:\\Games\\game.exe"],
      [
        { name: "game.exe", exe: null, pid: 10 },
        { name: "launcher.exe", exe: null, pid: 20 },
      ],
      () => false
    ),
    false
  );
});
