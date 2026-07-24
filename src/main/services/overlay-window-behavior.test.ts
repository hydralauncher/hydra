import assert from "node:assert/strict";
import test from "node:test";

import { boundsFillDisplay } from "./overlay-window-behavior.js";

test("recognizes fullscreen bounds without requiring exact rounding", () => {
  assert.equal(
    boundsFillDisplay(
      { x: -1, y: 0, width: 1921, height: 1080 },
      { x: 0, y: 0, width: 1920, height: 1080 }
    ),
    true
  );
});

test("does not classify a windowed game as fullscreen", () => {
  assert.equal(
    boundsFillDisplay(
      { x: 100, y: 100, width: 1600, height: 900 },
      { x: 0, y: 0, width: 1920, height: 1080 }
    ),
    false
  );
});
