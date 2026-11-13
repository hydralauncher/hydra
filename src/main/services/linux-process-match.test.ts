import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import {
  REAL_PATH_CACHE_TTL_MS,
  clearExecutableRealPathCache,
  doesSteamCompatDataPathMatchWinePrefix,
  getExecutablePathAliases,
  getWinePrefixAliases,
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  isLinuxGameWindowProcess,
  processReferencesExecutable,
  refreshExecutableRealPaths,
  refreshWinePrefixRealPaths,
  resolveExecutableRealPath,
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
});

describe("executable real path cache", () => {
  const storedPath = "/home/user/Games/Game/Game.exe";
  const resolvedPath = "/var/home/user/Games/Game/Game.exe";

  beforeEach(() => {
    clearExecutableRealPathCache();
  });

  it("returns only the stored path until a refresh has populated the cache", () => {
    assert.deepEqual(getExecutablePathAliases(storedPath), [storedPath]);
  });

  it("serves resolved paths from the cache after a refresh", async () => {
    const resolve = mock.fn(async () => resolvedPath);

    await refreshExecutableRealPaths([storedPath], resolve, 0);

    assert.deepEqual(getExecutablePathAliases(storedPath), [
      storedPath,
      resolvedPath,
    ]);
    assert.equal(resolve.mock.callCount(), 1);
  });

  it("resolves each distinct path once per refresh and reuses it within the ttl", async () => {
    const resolve = mock.fn(async () => resolvedPath);

    await refreshExecutableRealPaths([storedPath, storedPath], resolve, 0);
    await refreshExecutableRealPaths(
      [storedPath],
      resolve,
      REAL_PATH_CACHE_TTL_MS - 1
    );

    assert.equal(resolve.mock.callCount(), 1);

    await refreshExecutableRealPaths(
      [storedPath],
      resolve,
      REAL_PATH_CACHE_TTL_MS
    );

    assert.equal(resolve.mock.callCount(), 2);
  });

  it("shares an in-flight resolution between concurrent refreshes", async () => {
    let finish!: (value: string) => void;
    const resolve = mock.fn(
      () =>
        new Promise<string>((resolveValue) => {
          finish = resolveValue;
        })
    );

    const first = refreshExecutableRealPaths([storedPath], resolve, 0);
    const second = refreshExecutableRealPaths([storedPath], resolve, 0);
    finish(resolvedPath);
    await Promise.all([first, second]);

    assert.equal(resolve.mock.callCount(), 1);
  });

  it("keeps the stored path and does not throw when resolution fails", async () => {
    const resolve = mock.fn(async () => {
      throw new Error("ENOENT");
    });

    await refreshExecutableRealPaths([storedPath], resolve, 0);

    assert.deepEqual(getExecutablePathAliases(storedPath), [storedPath]);
    await refreshExecutableRealPaths([storedPath], resolve, 1);
    assert.equal(resolve.mock.callCount(), 1);
  });

  it("keeps the last resolved path when a later refresh fails", async () => {
    let calls = 0;
    const resolve = mock.fn(async () => {
      calls += 1;
      if (calls > 1) throw new Error("ENOENT");
      return resolvedPath;
    });

    await refreshExecutableRealPaths([storedPath], resolve, 0);
    await refreshExecutableRealPaths(
      [storedPath],
      resolve,
      REAL_PATH_CACHE_TTL_MS
    );

    assert.equal(resolve.mock.callCount(), 2);
    assert.deepEqual(getExecutablePathAliases(storedPath), [
      storedPath,
      resolvedPath,
    ]);
  });
});

describe("executable symlink resolution", () => {
  const realpath = mock.fn(async (value: string) => {
    if (value === "/home/user/Games/Game") return "/var/home/user/Games/Game";
    if (value === "/home/user/Games/Game/start") return "/usr/bin/python3.12";
    if (value === "/home/user/Games") return "/var/home/user/Games";
    return value;
  });

  it("resolves only the parent directory of the executable", async () => {
    assert.equal(
      await resolveExecutableRealPath("/home/user/Games/Game/start", realpath),
      "/var/home/user/Games/Game/start"
    );
    assert.equal(
      realpath.mock.calls.some(
        (call) => call.arguments[0] === "/home/user/Games/Game/start"
      ),
      false
    );
  });

  it("does not alias a symlinked executable to its target", async () => {
    clearExecutableRealPathCache();
    await refreshExecutableRealPaths(
      ["/home/user/Games/Game/start"],
      (value) => resolveExecutableRealPath(value, realpath),
      0
    );

    const aliases = getExecutablePathAliases("/home/user/Games/Game/start");

    assert.deepEqual(aliases, [
      "/home/user/Games/Game/start",
      "/var/home/user/Games/Game/start",
    ]);
    assert.equal(
      processReferencesExecutable(
        { cwd: "/usr/bin", exe: "/usr/bin/python3.12" },
        "/home/user/Games/Game/start"
      ),
      false
    );
  });
});

describe("wine prefix real path matching", () => {
  const storedPrefix = "/home/user/.config/hydralauncher/wine-prefixes/10";
  const resolvedPrefix =
    "/var/home/user/.config/hydralauncher/wine-prefixes/10";

  beforeEach(() => {
    clearExecutableRealPathCache();
  });

  it("matches a process whose prefix is reported under the resolved path", async () => {
    const processes = [
      {
        pid: 20,
        exe: "/usr/bin/wine64-preloader",
        cwd: "/tmp",
        environ: { STEAM_COMPAT_DATA_PATH: resolvedPrefix },
      },
    ];

    assert.equal(
      isLinuxGameWindowProcess(
        processes,
        20,
        undefined,
        ["/games/game.exe"],
        storedPrefix
      ),
      false
    );

    await refreshWinePrefixRealPaths(
      [storedPrefix],
      async () => resolvedPrefix
    );

    assert.deepEqual(getWinePrefixAliases(storedPrefix), [
      storedPrefix,
      resolvedPrefix,
    ]);
    assert.equal(
      isLinuxGameWindowProcess(
        processes,
        20,
        undefined,
        ["/games/game.exe"],
        storedPrefix
      ),
      true
    );
  });
});
