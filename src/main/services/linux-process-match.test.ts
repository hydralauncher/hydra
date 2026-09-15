import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  hasLaunchedPidMatch,
  isLinuxGameWindowProcess,
} from "./linux-process-match.js";
import type { LinuxProcessInfo } from "./linux-process-match.js";

const toProcess = (
  overrides: Partial<LinuxProcessInfo> & { pid: number }
): LinuxProcessInfo => ({
  name: "bash",
  cwd: "",
  exe: "/bin/bash",
  appImagePath: null,
  steamCompatDataPath: null,
  ...overrides,
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

  it("rejects a window merely sitting in a game subdirectory", () => {
    assert.equal(
      isLinuxGameWindowProcess(
        [{ pid: 20, exe: "/bin/bash", cwd: "/games/game/subdir" }],
        20,
        undefined,
        ["/games/game/start.sh"]
      ),
      false
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

describe("hasLaunchedPidMatch", () => {
  const executablePath = "/games/game/start.sh";

  it("matches the launched pid sitting in the game directory", () => {
    const pidToProcess = new Map([
      [100, toProcess({ pid: 100, cwd: "/games/game" })],
    ]);

    assert.equal(hasLaunchedPidMatch(100, executablePath, pidToProcess), true);
  });

  it("matches the launched pid sitting in a game subdirectory", () => {
    const pidToProcess = new Map([
      [100, toProcess({ pid: 100, cwd: "/games/game/game" })],
    ]);

    assert.equal(hasLaunchedPidMatch(100, executablePath, pidToProcess), true);
  });

  it("rejects the launched pid sitting outside the game directory", () => {
    const pidToProcess = new Map([
      [100, toProcess({ pid: 100, cwd: "/tmp" })],
      [101, toProcess({ pid: 101, cwd: "/games/unrelated" })],
    ]);

    assert.equal(hasLaunchedPidMatch(100, executablePath, pidToProcess), false);
    assert.equal(hasLaunchedPidMatch(101, executablePath, pidToProcess), false);
  });

  it("rejects unknown or missing pids", () => {
    assert.equal(hasLaunchedPidMatch(999, executablePath, new Map()), false);
    assert.equal(
      hasLaunchedPidMatch(undefined, executablePath, new Map()),
      false
    );
  });
});
