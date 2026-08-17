import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isWindowsGameForegroundProcess } from "./windows-game-window-match.js";

describe("Windows game foreground process matching", () => {
  it("accepts the process launched by Hydra", () => {
    assert.equal(isWindowsGameForegroundProcess([], 20, 20, []), true);
  });

  it("rejects a different process when Hydra tracked the launch", () => {
    assert.equal(
      isWindowsGameForegroundProcess(
        [{ pid: 20, exe: "C:\\Games\\game.exe" }],
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
});
