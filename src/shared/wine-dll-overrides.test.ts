import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mergeLaunchOptionEnvVars } from "./wine-dll-overrides.js";

describe("mergeLaunchOptionEnvVars", () => {
  it("adds the command placeholder after the env assignments", () => {
    assert.equal(
      mergeLaunchOptionEnvVars("", { WINEDLLOVERRIDES: "winmm=n,b" }),
      "WINEDLLOVERRIDES=winmm=n,b %command%"
    );
  });

  it("keeps existing game arguments after the command placeholder", () => {
    assert.equal(
      mergeLaunchOptionEnvVars("-skipintro -windowed", {
        WINEDLLOVERRIDES: "winmm=n,b",
        SteamOverlayGameId: "480",
      }),
      "WINEDLLOVERRIDES=winmm=n,b SteamOverlayGameId=480 %command% -skipintro -windowed"
    );
  });

  it("treats quoted env assignments as part of the env prefix", () => {
    assert.equal(
      mergeLaunchOptionEnvVars("-skipintro", {
        WINEDLLOVERRIDES: "winmm=n,b",
        STEAM_COMPAT_DATA_PATH: "/home/user/My Prefix",
      }),
      'WINEDLLOVERRIDES=winmm=n,b "STEAM_COMPAT_DATA_PATH=/home/user/My Prefix" %command% -skipintro'
    );
  });

  it("leaves an existing command placeholder where it is", () => {
    assert.equal(
      mergeLaunchOptionEnvVars("gamemoderun %command% -skipintro", {
        WINEDLLOVERRIDES: "winmm=n,b",
      }),
      "WINEDLLOVERRIDES=winmm=n,b gamemoderun %command% -skipintro"
    );
  });

  it("replaces an env var that is already set", () => {
    assert.equal(
      mergeLaunchOptionEnvVars("WINEDLLOVERRIDES=old=n %command% -skipintro", {
        WINEDLLOVERRIDES: "winmm=n,b",
      }),
      "WINEDLLOVERRIDES=winmm=n,b %command% -skipintro"
    );
  });
});
