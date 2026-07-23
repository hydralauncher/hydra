import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateOverlayPerformance,
  parseMangoHudFrameTimes,
  parsePresentMonFrameTime,
  resolvePresentMonFrameTimeColumns,
} from "./overlay-performance-metrics.js";

test("uses PresentMon display cadence and falls back to present cadence", () => {
  const indexes = resolvePresentMonFrameTimeColumns([
    "Application",
    "MsBetweenPresents",
    "MsBetweenDisplayChange",
  ]);

  assert.equal(
    parsePresentMonFrameTime(["game.exe", "8.3", "16.7"], indexes),
    16.7
  );
  assert.equal(
    parsePresentMonFrameTime(["game.exe", "8.3", "NA"], indexes),
    8.3
  );
});

test("recognizes legacy PresentMon metric casing", () => {
  const indexes = resolvePresentMonFrameTimeColumns([
    "Application",
    "msBetweenPresents",
    "msBetweenDisplayChange",
  ]);

  assert.equal(
    parsePresentMonFrameTime(["game.exe", "6.9", "0"], indexes),
    6.9
  );
});

test("parses only MangoHud frame metric rows", () => {
  assert.deepEqual(
    parseMangoHudFrameTimes([
      "os,cpu,gpu,ram,kernel,driver,cpuscheduler",
      "fps,frametime,cpu_load",
      "60,16.667,20",
      "invalid,10,20",
      "144,6.944,30",
    ]),
    [16.667, 6.944]
  );
});

test("calculates FPS metrics from frame times", () => {
  assert.deepEqual(calculateOverlayPerformance([20, 10, 10], 123), {
    fps: 75,
    averageFps: 75,
    onePercentLow: 50,
    frameTimeMs: 13.3,
    updatedAt: 123,
  });
});
