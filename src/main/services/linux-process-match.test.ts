import assert from "node:assert/strict";
import test from "node:test";

import {
  hasLinuxNativeOrAppImageMatch,
  processReferencesExecutable,
} from "./linux-process-match.js";

test("matches native Linux executables with case-sensitive paths", () => {
  const processes = [
    {
      name: "game",
      cwd: "/Games/Example",
      exe: "/Games/Example/game",
      pid: 42,
      appImagePath: null,
      steamCompatDataPath: null,
    },
  ];

  assert.equal(
    hasLinuxNativeOrAppImageMatch("/Games/Example/game", processes),
    true
  );
  assert.equal(
    hasLinuxNativeOrAppImageMatch("/games/example/game", processes),
    false
  );
});

test("uses case-insensitive matching only for Windows executables under Wine", () => {
  assert.equal(
    processReferencesExecutable(
      { exe: "/Games/Example/GAME.EXE" },
      "/games/example/game.exe"
    ),
    true
  );
  assert.equal(
    processReferencesExecutable(
      { exe: "/Games/Example/game" },
      "/games/example/game"
    ),
    false
  );
});

test("does not match unrelated processes by working directory", () => {
  const process = { cwd: "/games/example", exe: "/usr/bin/helper" };

  assert.equal(
    processReferencesExecutable(process, "/games/example/game"),
    false
  );
  assert.equal(
    processReferencesExecutable(process, "/games/example/game", true),
    true
  );
});
