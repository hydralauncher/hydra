import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getWindowsProcessAncestryDiagnostics,
  isWindowsGameForegroundProcess,
  isWindowsWindowSource,
} from "./windows-game-window-match.js";

describe("Windows game foreground process matching", () => {
  it("accepts the process launched by Hydra", () => {
    assert.equal(isWindowsGameForegroundProcess([], 20, 20, []), true);
  });

  it("accepts an exact executable after the launched process is replaced", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [{ pid: 20, exe: "C:\\Games\\game.exe" }],
        20,
        10,
        ["C:\\Games\\game.exe"]
      ),
      true
    );
  });

  it("rejects a replaced process with an unrelated executable", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [{ pid: 20, exe: "C:\\Windows\\browser.exe" }],
        20,
        10,
        ["C:\\Games\\game.exe"]
      ),
      false
    );
  });

  it("accepts the exact foreground executable without a launch PID", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [{ pid: 20, exe: "C:\\Games\\Game.exe" }],
        20,
        undefined,
        ["c:/games/game.exe"]
      ),
      true
    );
  });

  it("accepts an exact configured tracking executable", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [{ pid: 20, exe: "C:\\Games\\bin\\game-win64.exe" }],
        20,
        undefined,
        ["C:\\Games\\launcher.exe", "C:\\Games\\bin\\game-win64.exe"]
      ),
      true
    );
  });

  it("accepts a game window launched by a configured executable", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [
          {
            pid: 20,
            parentPid: 10,
            exe: "C:\\Games\\SHProto\\Binaries\\SHProto-Win64-Shipping.exe",
          },
          { pid: 10, parentPid: null, exe: "C:\\Games\\SHProto.exe" },
        ],
        20,
        undefined,
        ["C:\\Games\\SHProto.exe"]
      ),
      true
    );
  });

  it("accepts a descendant of the process launched by Hydra", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [
          { pid: 30, parentPid: 20, exe: null },
          { pid: 20, parentPid: 10, exe: null },
          { pid: 10, parentPid: null, exe: null },
        ],
        30,
        10,
        []
      ),
      true
    );
  });

  it("rejects an unrelated foreground executable", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [{ pid: 20, exe: "C:\\Windows\\browser.exe" }],
        20,
        undefined,
        ["C:\\Games\\game.exe"]
      ),
      false
    );
  });

  it("rejects a process whose unrelated sibling matches the game", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [
          { pid: 10, parentPid: 30, exe: "C:\\Games\\game.exe" },
          { pid: 20, parentPid: 30, exe: "C:\\Windows\\browser.exe" },
          { pid: 30, parentPid: null, exe: "C:\\Windows\\explorer.exe" },
        ],
        20,
        undefined,
        ["C:\\Games\\game.exe"]
      ),
      false
    );
  });

  it("rejects a cyclic process tree without hanging", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [
          { pid: 20, parentPid: 30, exe: "C:\\Windows\\browser.exe" },
          { pid: 30, parentPid: 20, exe: "C:\\Windows\\explorer.exe" },
        ],
        20,
        undefined,
        ["C:\\Games\\game.exe"]
      ),
      false
    );
  });
});

describe("Windows game window source matching", () => {
  it("matches the native window handle in an Electron source ID", () => {
    assert.equal(isWindowsWindowSource("window:12345:0", "12345"), true);
  });

  it("normalizes numeric window handles", () => {
    assert.equal(isWindowsWindowSource("window:0012345:0", "12345"), true);
  });

  it("rejects another window handle", () => {
    assert.equal(isWindowsWindowSource("window:12345:0", "54321"), false);
  });

  it("rejects malformed source IDs", () => {
    assert.equal(isWindowsWindowSource("screen:12345:0", "12345"), false);
  });
});

describe("Windows process ancestry diagnostics", () => {
  it("describes the foreground process and its parents", () => {
    assert.deepEqual(
      getWindowsProcessAncestryDiagnostics(
        [
          {
            pid: 20,
            parentPid: 10,
            exe: "C:\\Games\\game.exe",
            name: "game.exe",
          },
          {
            pid: 10,
            parentPid: null,
            exe: "C:\\Games\\launcher.exe",
            name: "launcher.exe",
          },
        ],
        20
      ),
      [
        {
          pid: 20,
          parentPid: 10,
          exe: "C:\\Games\\game.exe",
          name: "game.exe",
          processFound: true,
        },
        {
          pid: 10,
          parentPid: null,
          exe: "C:\\Games\\launcher.exe",
          name: "launcher.exe",
          processFound: true,
        },
      ]
    );
  });

  it("records when process enumeration is missing a parent", () => {
    assert.deepEqual(
      getWindowsProcessAncestryDiagnostics(
        [
          {
            pid: 20,
            parentPid: 10,
            exe: "C:\\Games\\game.exe",
            name: "game.exe",
          },
        ],
        20
      ),
      [
        {
          pid: 20,
          parentPid: 10,
          exe: "C:\\Games\\game.exe",
          name: "game.exe",
          processFound: true,
        },
        { pid: 10, processFound: false },
      ]
    );
  });
});
