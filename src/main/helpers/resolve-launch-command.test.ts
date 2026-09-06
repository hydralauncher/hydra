import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveLaunchCommand } from "./resolve-launch-command.ts";

describe("resolveLaunchCommand", () => {
  it("treats leading VAR=VAL tokens as env even without %command%", () => {
    const resolved = resolveLaunchCommand({
      baseCommand: "/usr/bin/python3",
      baseArgs: ["/opt/Hydra/resources/umu-run", "/games/game.exe"],
      launchOptions:
        "SteamAppId=480 SteamGameId=480 WINEDLLOVERRIDES=winmm=n,b -dx11",
    });

    assert.equal(resolved.command, "/usr/bin/python3");
    assert.deepEqual(resolved.args, [
      "/opt/Hydra/resources/umu-run",
      "/games/game.exe",
      "-dx11",
    ]);
    assert.deepEqual(resolved.env, {
      SteamAppId: "480",
      SteamGameId: "480",
      WINEDLLOVERRIDES: "winmm=n,b",
    });
  });

  it("keeps previous behavior when no leading env assignments exist", () => {
    const resolved = resolveLaunchCommand({
      baseCommand: "/usr/bin/python3",
      baseArgs: ["/opt/Hydra/resources/umu-run", "/games/game.exe"],
      launchOptions: "-dx11 -windowed",
    });

    assert.equal(resolved.command, "/usr/bin/python3");
    assert.deepEqual(resolved.args, [
      "/opt/Hydra/resources/umu-run",
      "/games/game.exe",
      "-dx11",
      "-windowed",
    ]);
    assert.deepEqual(resolved.env, {});
  });

  it("still supports %command% placeholder with leading env", () => {
    const resolved = resolveLaunchCommand({
      baseCommand: "/usr/bin/python3",
      baseArgs: ["/opt/Hydra/resources/umu-run", "/games/game.exe"],
      launchOptions: "SteamAppId=480 %command% -dx11",
    });

    assert.deepEqual(resolved.env, { SteamAppId: "480" });
    assert.ok(resolved.args.includes("-dx11"));
  });
});
