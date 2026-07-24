import assert from "node:assert/strict";
import test from "node:test";

import {
  prioritizeVisibleOverlayProcesses,
  rankOverlayGameProcesses,
} from "./overlay-game-process-ranking.js";

test("prefers an exact executable path over a foreground basename match", () => {
  const candidates = rankOverlayGameProcesses(
    [
      {
        pid: 10,
        name: "game.exe",
        exe: "D:\\Other\\game.exe",
        startTime: 200,
      },
      {
        pid: 20,
        name: "game.exe",
        exe: "C:\\Games\\game.exe",
        startTime: 100,
      },
    ],
    ["C:\\Games\\game.exe"],
    10
  );

  assert.equal(candidates[0]?.pid, 20);
});

test("uses foreground and start time to disambiguate matching child processes", () => {
  const candidates = rankOverlayGameProcesses(
    [
      { pid: 10, name: "game.exe", exe: null, startTime: 100 },
      { pid: 20, name: "game.exe", exe: null, startTime: 200 },
    ],
    ["C:\\Games\\game.exe"],
    10
  );

  assert.equal(candidates[0]?.pid, 10);

  const withoutForeground = rankOverlayGameProcesses(candidates, [
    "C:\\Games\\game.exe",
  ]);
  assert.equal(withoutForeground[0]?.pid, 20);
});

test("prefers a process with a visible game window over a launch stub", () => {
  const candidates = rankOverlayGameProcesses(
    [
      { pid: 10, name: "game.exe", exe: "C:\\Games\\game.exe" },
      { pid: 20, name: "game.exe", exe: "D:\\Games\\game.exe" },
    ],
    ["C:\\Games\\game.exe"]
  );

  const visible = prioritizeVisibleOverlayProcesses(candidates, new Set([20]));
  assert.equal(visible[0]?.pid, 20);
});
