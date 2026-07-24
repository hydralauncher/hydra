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
