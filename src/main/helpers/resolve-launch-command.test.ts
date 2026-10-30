import { describe, it } from "node:test";
import assert from "node:assert";

import { resolveLaunchCommand } from "./resolve-launch-command.ts";

describe("resolveLaunchCommand", () => {
  it("moves leading assignments before %command% into the environment", () => {
    const resolved = resolveLaunchCommand({
      baseCommand: "umu-run",
      baseArgs: ["game.exe"],
      launchOptions: "WINEDLLOVERRIDES=version=n mangohud %command% -novid",
    });

    assert.deepStrictEqual(resolved, {
      command: "mangohud",
      args: ["umu-run", "game.exe", "-novid"],
      env: { WINEDLLOVERRIDES: "version=n" },
    });
  });

  it("removes shell quotes around environment values", () => {
    const resolved = resolveLaunchCommand({
      baseCommand: "umu-run",
      baseArgs: ["game.exe"],
      launchOptions:
        "WINEDLLOVERRIDES=\"version=n,b\" DXVK_CONFIG='dxvk.tearFree = True' %command%",
    });

    assert.deepStrictEqual(resolved.env, {
      WINEDLLOVERRIDES: "version=n,b",
      DXVK_CONFIG: "dxvk.tearFree = True",
    });
    assert.equal(resolved.command, "umu-run");
    assert.deepStrictEqual(resolved.args, ["game.exe"]);
  });
});
