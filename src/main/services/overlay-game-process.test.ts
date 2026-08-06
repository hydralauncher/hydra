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

test("prefers a visible exact process over an inaccessible launch stub", () => {
  const candidates = rankOverlayGameProcesses(
    [
      { pid: 10, name: "game.exe", exe: "C:\\Games\\game.exe" },
      { pid: 20, name: "game.exe", exe: null },
    ],
    ["C:\\Games\\game.exe"]
  );

  const visible = prioritizeVisibleOverlayProcesses(candidates, new Set([20]));
  assert.equal(visible[0]?.pid, 20);
});

test("preserves native Linux executable path casing", () => {
  const ranked = rankOverlayGameProcesses(
    [
      { pid: 10, name: "Game", exe: "/games/Game", startTime: 1 },
      { pid: 11, name: "game", exe: "/games/game", startTime: 2 },
    ],
    ["/games/Game"],
    0,
    "linux"
  );

  assert.deepEqual(
    ranked.map(({ pid }) => pid),
    [10]
  );
});

test("matches Windows executables under Wine case-insensitively", () => {
  const ranked = rankOverlayGameProcesses(
    [{ pid: 10, name: "GAME.EXE", exe: "/games/GAME.EXE", startTime: 1 }],
    ["/games/game.exe"],
    0,
    "linux"
  );

  assert.equal(ranked[0]?.pid, 10);
});
