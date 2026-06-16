import assert from "node:assert";
import { describe, it } from "node:test";

import {
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  type LinuxProcessInfo,
} from "./linux-process-match.ts";

const makeProcess = (
  overrides: Partial<LinuxProcessInfo>
): LinuxProcessInfo => ({
  name: "proc",
  cwd: "",
  exe: "",
  pid: 0,
  appImagePath: null,
  steamCompatDataPath: null,
  ...overrides,
});

describe("hasLinuxNativeOrAppImageMatch", () => {
  it("matches a native binary by resolved exe path", () => {
    const processes = [
      makeProcess({ exe: "/games/celeste/celeste.x86_64", pid: 10 }),
    ];

    assert.equal(
      hasLinuxNativeOrAppImageMatch("/games/celeste/celeste.x86_64", processes),
      true
    );
  });

  it("matches case-insensitively (entries are lowercased upstream)", () => {
    const processes = [makeProcess({ exe: "/games/game/start.x86_64" })];

    assert.equal(
      hasLinuxNativeOrAppImageMatch("/games/Game/Start.x86_64", processes),
      true
    );
  });

  it("matches an AppImage by the APPIMAGE env var", () => {
    const processes = [
      makeProcess({
        exe: "/tmp/.mount_gamexxxx/usr/bin/game",
        appImagePath: "/home/u/apps/game.appimage",
        pid: 22,
      }),
    ];

    assert.equal(
      hasLinuxNativeOrAppImageMatch("/home/u/apps/Game.AppImage", processes),
      true
    );
  });

  it("does not match when neither exe nor appImagePath line up", () => {
    const processes = [
      makeProcess({ exe: "/usr/bin/firefox" }),
      makeProcess({ exe: "/bin/bash", appImagePath: null }),
    ];

    assert.equal(
      hasLinuxNativeOrAppImageMatch("/games/game/game.x86_64", processes),
      false
    );
  });

  it("does not treat a null appImagePath as a match", () => {
    const processes = [makeProcess({ exe: "/bin/bash", appImagePath: null })];

    assert.equal(hasLinuxNativeOrAppImageMatch("", processes), false);
  });
});

describe("hasLaunchedPidMatch", () => {
  const path = "/games/game/launch.sh";
  const buildMap = (entries: LinuxProcessInfo[]) =>
    new Map(entries.map((entry) => [entry.pid, entry]));

  it("returns false when no pid was captured", () => {
    const map = buildMap([makeProcess({ pid: 100, cwd: "/games/game" })]);

    assert.equal(hasLaunchedPidMatch(undefined, path, map), false);
  });

  it("returns false when the captured pid is no longer alive", () => {
    const map = buildMap([makeProcess({ pid: 999, cwd: "/games/game" })]);

    assert.equal(hasLaunchedPidMatch(100, path, map), false);
  });

  it("matches a launcher script whose pid stays alive in the game dir", () => {
    const map = buildMap([
      makeProcess({ pid: 100, exe: "/bin/bash", cwd: "/games/game" }),
    ]);

    assert.equal(hasLaunchedPidMatch(100, path, map), true);
  });

  it("matches an exec-style script whose pid now points at the game binary", () => {
    const map = buildMap([
      makeProcess({ pid: 100, exe: "/games/game/launch.sh", cwd: "/other" }),
    ]);

    assert.equal(hasLaunchedPidMatch(100, path, map), true);
  });

  it("does not match a recycled pid that lives elsewhere (recycle guard)", () => {
    const map = buildMap([
      makeProcess({ pid: 100, exe: "/usr/lib/systemd", cwd: "/" }),
    ]);

    assert.equal(hasLaunchedPidMatch(100, path, map), false);
  });
});
