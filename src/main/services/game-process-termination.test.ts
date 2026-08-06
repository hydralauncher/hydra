import assert from "node:assert/strict";
import test from "node:test";

import {
  expandProcessTree,
  matchesWindowsExecutable,
} from "./game-process-termination.js";

test("matches Windows executable paths case-insensitively", () => {
  assert.equal(
    matchesWindowsExecutable("C:\\GAMES\\Game.exe", ["c:\\games\\game.exe"]),
    true
  );
});

test("terminates descendants before their tracked game process", () => {
  const pids = expandProcessTree(
    [
      { pid: 10, name: "launcher", exe: null, parentPid: null },
      { pid: 20, name: "game", exe: null, parentPid: 10 },
      { pid: 30, name: "helper", exe: null, parentPid: 20 },
      { pid: 40, name: "unrelated", exe: null, parentPid: null },
    ],
    [10],
    99
  );

  assert.deepEqual(pids, [30, 20, 10]);
});
