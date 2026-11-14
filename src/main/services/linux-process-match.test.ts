import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildLinuxProcessMatchIndex,
  doesSteamCompatDataPathMatchWinePrefix,
  hasLinuxCompatibilityProcessMatch,
  hasLinuxNativeOrAppImageMatch,
  isLinuxGameWindowProcess,
} from "./linux-process-match.js";

describe("Steam compatibility prefix matching", () => {
  it("matches both compatibility roots and their pfx directories", () => {
    assert.equal(
      doesSteamCompatDataPathMatchWinePrefix(
        "/games/compatdata/620",
        "/games/compatdata/620/pfx"
      ),
      true
    );
    assert.equal(
      doesSteamCompatDataPathMatchWinePrefix(
        "/games/compatdata/730",
        "/games/compatdata/620/pfx"
      ),
      false
    );
  });
});

describe("Linux game window process matching", () => {
  it("accepts a descendant of the process launched by Hydra", () => {
    assert.equal(
      isLinuxGameWindowProcess(
        [
          { pid: 10, parentPid: null, exe: "/usr/bin/wrapper", cwd: "/tmp" },
          { pid: 20, parentPid: 10, exe: "/games/game", cwd: "/games" },
        ],
        20,
        10,
        []
      ),
      true
    );
  });

  it("accepts a process that references the configured executable", () => {
    assert.equal(
      isLinuxGameWindowProcess(
        [{ pid: 20, exe: "/games/game", cwd: "/games" }],
        20,
        undefined,
        ["/games/game"]
      ),
      true
    );
  });

  it("accepts a Wine process from the configured compatibility prefix", () => {
    assert.equal(
      isLinuxGameWindowProcess(
        [
          {
            pid: 20,
            exe: "/usr/bin/wine64-preloader",
            cwd: "/tmp",
            environ: { STEAM_COMPAT_DATA_PATH: "/games/prefix" },
          },
        ],
        20,
        undefined,
        ["/games/game.exe"],
        "/games/prefix"
      ),
      true
    );
  });

  it("accepts a Proton process whose compatibility data contains the prefix", () => {
    assert.equal(
      isLinuxGameWindowProcess(
        [
          {
            pid: 20,
            exe: "/usr/bin/wine64-preloader",
            cwd: "/tmp",
            environ: { STEAM_COMPAT_DATA_PATH: "/games/compatdata/10" },
          },
        ],
        20,
        undefined,
        ["/games/game.exe"],
        "/games/compatdata/10/pfx"
      ),
      true
    );
  });

  it("rejects an unrelated active process", () => {
    assert.equal(
      isLinuxGameWindowProcess(
        [{ pid: 20, exe: "/usr/bin/browser", cwd: "/home/user" }],
        20,
        10,
        ["/games/game"]
      ),
      false
    );
  });
});

describe("Linux process match index", () => {
  const processes = [
    {
      name: "game",
      cwd: "/games/native",
      exe: "/games/native/game",
      pid: 10,
      appImagePath: null,
      steamCompatDataPath: null,
    },
    {
      name: "game.AppImage",
      cwd: "/tmp",
      exe: "/tmp/.mount_game/AppRun",
      pid: 20,
      appImagePath: "/games/game.appimage",
      steamCompatDataPath: null,
    },
    {
      name: "game.exe",
      cwd: "/games/wine",
      exe: "/usr/bin/wine64-preloader",
      pid: 30,
      appImagePath: null,
      steamCompatDataPath: "/games/compatdata/620",
    },
  ];

  it("indexes exe and AppImage paths", () => {
    const index = buildLinuxProcessMatchIndex(processes);

    assert.equal(
      hasLinuxNativeOrAppImageMatch("/games/native/game", index),
      true
    );
    assert.equal(
      hasLinuxNativeOrAppImageMatch("/games/game.APPIMAGE", index),
      true
    );
    assert.equal(
      hasLinuxNativeOrAppImageMatch("/games/native/other", index),
      false
    );
  });

  it("matches compatibility processes by cwd and executable name", () => {
    const index = buildLinuxProcessMatchIndex(processes);

    assert.equal(
      hasLinuxCompatibilityProcessMatch(index, {
        executablePath: "/games/wine/game.exe",
      }),
      true
    );
    assert.equal(
      hasLinuxCompatibilityProcessMatch(index, {
        executablePath: "/games/wine/game",
      }),
      false
    );
  });

  it("preserves Wine prefix filtering", () => {
    const index = buildLinuxProcessMatchIndex(processes);

    assert.equal(
      hasLinuxCompatibilityProcessMatch(index, {
        executablePath: "/games/wine/game.exe",
        expectedWinePrefix: "/games/compatdata/620/pfx",
      }),
      true
    );
    assert.equal(
      hasLinuxCompatibilityProcessMatch(index, {
        executablePath: "/games/wine/game.exe",
        expectedWinePrefix: "/games/compatdata/730/pfx",
      }),
      false
    );
  });
});
