import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  doesSteamCompatDataPathMatchWinePrefix,
  getExecutablePathAliases,
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  isLinuxGameWindowProcess,
  processReferencesExecutable,
  type LinuxProcessInfo,
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

describe("symlinked executable path matching", () => {
  const storedPath = "/home/user/Games/Game/Win64/Game.exe";
  const resolvedPath = "/var/home/user/Games/Game/Win64/Game.exe";
  const resolveHome = (value: string) =>
    value.startsWith("/home/") ? `/var${value}` : value;
  const identity = (value: string) => value;

  const gameProcess: LinuxProcessInfo = {
    name: "game.exe",
    cwd: "/var/home/user/games/game/win64",
    exe: resolvedPath.toLowerCase(),
    pid: 42,
    appImagePath: null,
    steamCompatDataPath: null,
  };

  it("returns the stored path first and the resolved path when it differs", () => {
    assert.deepEqual(getExecutablePathAliases(storedPath, resolveHome), [
      storedPath,
      resolvedPath,
    ]);
    assert.deepEqual(getExecutablePathAliases(storedPath, identity), [
      storedPath,
    ]);
  });

  it("matches a process reported under the resolved path", () => {
    assert.equal(
      processReferencesExecutable(
        { cwd: gameProcess.cwd, exe: null },
        storedPath,
        resolveHome
      ),
      true
    );
    assert.equal(
      processReferencesExecutable(
        { cwd: null, exe: gameProcess.exe },
        storedPath,
        resolveHome
      ),
      true
    );
  });

  it("keeps matching a process reported under the stored path", () => {
    assert.equal(
      processReferencesExecutable(
        { cwd: "/home/user/games/game/win64", exe: null },
        storedPath,
        resolveHome
      ),
      true
    );
  });

  it("does not match an unrelated process", () => {
    assert.equal(
      processReferencesExecutable(
        { cwd: "/var/home/user/other", exe: "/usr/bin/python3" },
        storedPath,
        resolveHome
      ),
      false
    );
    assert.equal(
      processReferencesExecutable(
        { cwd: gameProcess.cwd, exe: gameProcess.exe },
        storedPath,
        identity
      ),
      false
    );
  });

  it("matches the Hydra launched PID by its resolved working directory", () => {
    const processes = new Map([[42, gameProcess]]);

    assert.equal(
      hasLaunchedPidMatch(42, storedPath, processes, resolveHome),
      true
    );
    assert.equal(
      hasLaunchedPidMatch(42, storedPath, processes, identity),
      false
    );
    assert.equal(
      hasLaunchedPidMatch(7, storedPath, processes, resolveHome),
      false
    );
  });

  it("matches native and AppImage processes by resolved path", () => {
    assert.equal(
      hasLinuxNativeOrAppImageMatch(storedPath, [gameProcess], resolveHome),
      true
    );
    assert.equal(
      hasLinuxNativeOrAppImageMatch(storedPath, [gameProcess], identity),
      false
    );
    assert.equal(
      hasLinuxNativeOrAppImageMatch(
        storedPath,
        [
          {
            ...gameProcess,
            exe: "/usr/bin/other",
            appImagePath: resolvedPath.toLowerCase(),
          },
        ],
        resolveHome
      ),
      true
    );
  });

  it("falls back to the stored path when it cannot be resolved", () => {
    const missing = "/nonexistent-hydra-test/Game.exe";

    assert.deepEqual(getExecutablePathAliases(missing), [missing]);
  });
});
