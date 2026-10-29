import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findForegroundGameTarget,
  findSoleLaunchedTarget,
  isLaunchedForegroundProcess,
  matchesSandboxedWindowProcess,
  parseNamespacedPids,
  type ForegroundGameMatchInput,
  type ForegroundProcess,
  type ScreenshotGameTarget,
} from "./foreground-game-match.js";

const target = (
  gameKey: string,
  overrides: Partial<ScreenshotGameTarget> = {}
): ScreenshotGameTarget => ({
  gameKey,
  shop: "steam",
  objectId: gameKey,
  title: gameKey,
  executablePaths: [],
  isEmulator: false,
  ...overrides,
});

const processes: ForegroundProcess[] = [
  { pid: 1, parentPid: null },
  { pid: 100, parentPid: 1 },
  { pid: 101, parentPid: 100 },
  { pid: 200, parentPid: 1 },
  { pid: 300, parentPid: 200 },
  { pid: 400, parentPid: 1, exe: "/games/other/other.x86_64" },
  { pid: 500, parentPid: 1 },
];

const namespacedPids = new Map<number, number[]>([
  [300, [300, 5]],
  [500, [500, 9]],
]);
const getNamespacedPids = (hostPid: number) =>
  namespacedPids.get(hostPid) ?? null;

const linuxInput = (
  overrides: Partial<ForegroundGameMatchInput>
): ForegroundGameMatchInput => ({
  platform: "linux",
  targets: [target("a", { processId: 100 }), target("b", { processId: 200 })],
  foreground: { processId: null },
  processes,
  ...overrides,
});

describe("foreground game match on Linux", () => {
  it("matches a window owned by a descendant of the launched process", () => {
    assert.equal(
      findForegroundGameTarget(linuxInput({ foreground: { processId: 101 } }))
        ?.gameKey,
      "a"
    );
  });

  it("matches the X11 client pid when the window pid is unrelated", () => {
    assert.equal(
      findForegroundGameTarget(
        linuxInput({ foreground: { processId: 999, clientProcessId: 300 } })
      )?.gameKey,
      "b"
    );
  });

  it("matches a game by executable when it was not launched by Hydra", () => {
    assert.equal(
      findForegroundGameTarget(
        linuxInput({
          targets: [
            target("a", { processId: 100 }),
            target("other", {
              executablePaths: ["/games/other/other.x86_64"],
            }),
          ],
          foreground: { processId: 400 },
        })
      )?.gameKey,
      "other"
    );
  });

  it("matches a sandboxed window only with the namespaced pid lookup", () => {
    const input = linuxInput({ foreground: { processId: 5 } });

    assert.equal(findForegroundGameTarget(input), null);
    assert.equal(
      findForegroundGameTarget({ ...input, getNamespacedPids })?.gameKey,
      "b"
    );
  });

  it("does not use the namespaced lookup when a client pid is known", () => {
    assert.equal(
      findForegroundGameTarget(
        linuxInput({
          foreground: { processId: 5, clientProcessId: 999 },
          getNamespacedPids,
        })
      ),
      null
    );
  });

  it("returns nothing for an unrelated window", () => {
    assert.equal(
      findForegroundGameTarget(
        linuxInput({ foreground: { processId: 500 }, getNamespacedPids })
      ),
      null
    );
  });

  it("prefers the target whose process tree owns the window", () => {
    const sharedExecutable = "/games/shared/game.x86_64";
    assert.equal(
      findForegroundGameTarget(
        linuxInput({
          targets: [
            target("a", {
              processId: 100,
              executablePaths: [sharedExecutable],
            }),
            target("b", {
              processId: 200,
              executablePaths: [sharedExecutable],
            }),
          ],
          processes: [
            ...processes,
            { pid: 301, parentPid: 200, exe: sharedExecutable },
          ],
          foreground: { processId: 301 },
        })
      )?.gameKey,
      "b"
    );
  });

  it("falls back to the only launched target when ownership is unknown", () => {
    const sharedExecutable = "/games/shared/game.x86_64";
    assert.equal(
      findForegroundGameTarget(
        linuxInput({
          targets: [
            target("launched", {
              processId: 100,
              executablePaths: [sharedExecutable],
            }),
            target("detected", { executablePaths: [sharedExecutable] }),
          ],
          processes: [
            ...processes,
            { pid: 600, parentPid: 1, exe: sharedExecutable },
          ],
          foreground: { processId: 600 },
        })
      )?.gameKey,
      "launched"
    );
  });
});

describe("sandboxed window process match", () => {
  it("matches a single namespaced owner inside the launched tree", () => {
    assert.equal(
      matchesSandboxedWindowProcess(processes, 5, 200, getNamespacedPids),
      true
    );
  });

  it("rejects owners outside the launched tree", () => {
    assert.equal(
      matchesSandboxedWindowProcess(processes, 9, 200, getNamespacedPids),
      false
    );
  });

  it("rejects ambiguous namespaced pids", () => {
    const lookup = (hostPid: number) =>
      hostPid === 101 ? [101, 5] : getNamespacedPids(hostPid);

    assert.equal(
      matchesSandboxedWindowProcess(processes, 5, 200, lookup),
      false
    );
  });

  it("ignores processes that are not in a nested namespace", () => {
    assert.equal(
      matchesSandboxedWindowProcess(processes, 300, 200, getNamespacedPids),
      false
    );
  });

  it("requires a launched process", () => {
    assert.equal(
      matchesSandboxedWindowProcess(processes, 5, undefined, getNamespacedPids),
      false
    );
  });
});

describe("foreground game match on Windows", () => {
  it("matches by launched ancestry or executable path", () => {
    const input: ForegroundGameMatchInput = {
      platform: "win32",
      targets: [
        target("launched", { processId: 100 }),
        target("detected", {
          executablePaths: ["C:\\Games\\Detected\\Game.exe"],
        }),
      ],
      foreground: { processId: 101 },
      processes: [
        ...processes,
        { pid: 700, parentPid: 1, exe: "c:/games/detected/game.exe" },
      ],
    };

    assert.equal(findForegroundGameTarget(input)?.gameKey, "launched");
    assert.equal(
      findForegroundGameTarget({ ...input, foreground: { processId: 700 } })
        ?.gameKey,
      "detected"
    );
    assert.equal(
      findForegroundGameTarget({ ...input, foreground: { processId: null } }),
      null
    );
  });
});

describe("foreground game match helpers", () => {
  it("finds the only launched target", () => {
    const launched = target("launched", { processId: 100 });
    const detected = target("detected");

    assert.equal(findSoleLaunchedTarget([detected]), detected);
    assert.equal(findSoleLaunchedTarget([launched, detected]), launched);
    assert.equal(
      findSoleLaunchedTarget([launched, target("b", { processId: 200 })]),
      null
    );
    assert.equal(findSoleLaunchedTarget([detected, target("c")]), null);
  });

  it("recognises the launched process as the foreground owner", () => {
    const launched = target("a", { processId: 100 });

    assert.equal(
      isLaunchedForegroundProcess(launched, { processId: 100 }),
      true
    );
    assert.equal(
      isLaunchedForegroundProcess(launched, {
        processId: 1,
        clientProcessId: 100,
      }),
      true
    );
    assert.equal(
      isLaunchedForegroundProcess(launched, { processId: 101 }),
      false
    );
    assert.equal(
      isLaunchedForegroundProcess(target("b"), { processId: 100 }),
      false
    );
  });

  it("parses the namespaced pid chain from proc status", () => {
    assert.deepEqual(
      parseNamespacedPids("Name:\tgame\nNSpid:\t4321\t12\t2\nVmRSS:\t1 kB\n"),
      [4321, 12, 2]
    );
    assert.deepEqual(parseNamespacedPids("NSpid:\t4321\n"), [4321]);
    assert.equal(parseNamespacedPids("Name:\tgame\n"), null);
    assert.equal(parseNamespacedPids("NSpid:\t\n"), null);
  });
});
