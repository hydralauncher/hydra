import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGamescopeMangoHud } from "./linux-gamescope-launch.js";

test("uses gamescope mangoapp instead of wrapping gamescope with mangohud", () => {
  const resolved = normalizeGamescopeMangoHud(
    {
      command: "gamemoderun",
      args: ["mangohud", "gamescope", "-f", "--", "/games/example"],
      env: {},
    },
    true,
    "linux"
  );

  assert.deepEqual(resolved, {
    command: "gamemoderun",
    args: ["gamescope", "--mangoapp", "-f", "--", "/games/example"],
    env: {},
  });
});

test("does not alter non-gamescope commands", () => {
  const command = {
    command: "mangohud",
    args: ["/games/example"],
    env: {},
  };

  assert.deepEqual(normalizeGamescopeMangoHud(command, true, "linux"), command);
});

test("normalizes gamescope when it is the wrapped command", () => {
  const command = {
    command: "mangohud",
    args: ["gamescope", "--", "/games/gamescope"],
    env: {},
  };

  assert.deepEqual(normalizeGamescopeMangoHud(command, true, "linux"), {
    command: "gamescope",
    args: ["--mangoapp", "--", "/games/gamescope"],
    env: {},
  });
});

test("does not treat the launched game as a gamescope wrapper", () => {
  const gameOnly = {
    command: "mangohud",
    args: ["launcher", "--", "/games/gamescope"],
    env: {},
  };
  assert.deepEqual(
    normalizeGamescopeMangoHud(gameOnly, true, "linux"),
    gameOnly
  );
});
