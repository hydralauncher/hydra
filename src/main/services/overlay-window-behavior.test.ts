import assert from "node:assert/strict";
import test from "node:test";

import {
  boundsFillDisplay,
  findDisplayForNativeBounds,
  fitAuxiliaryWindow,
} from "./overlay-window-behavior.js";

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

test("fits auxiliary windows inside very small targets", () => {
  assert.deepEqual(
    fitAuxiliaryWindow(
      { x: -100, y: 50, width: 180, height: 100 },
      620,
      190,
      24,
      "right"
    ),
    { x: -88, y: 62, width: 156, height: 76 }
  );
});

test("selects a scaled Linux display from native pixel bounds", () => {
  const displays = [
    {
      id: 1,
      bounds: { x: 0, y: 0, width: 1280, height: 720 },
      scaleFactor: 2,
    },
    {
      id: 2,
      bounds: { x: 1280, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
    },
  ];

  assert.equal(
    findDisplayForNativeBounds(
      { x: 0, y: 0, width: 2560, height: 1440 },
      displays
    )?.id,
    1
  );
});

test("defers display selection when native bounds do not overlap", () => {
  assert.equal(
    findDisplayForNativeBounds(
      { x: 10_000, y: 10_000, width: 800, height: 600 },
      [
        {
          id: 1,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          scaleFactor: 1,
        },
      ]
    ),
    null
  );
});
