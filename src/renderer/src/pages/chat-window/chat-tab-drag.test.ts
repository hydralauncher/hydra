import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyVisibleOrder,
  clampDragOffset,
  getDragTargetIndex,
  getDropOffset,
  getTabShift,
  moveItem,
  type TabSlot,
} from "./chat-tab-drag.js";

// a(100) b(150, active) c(100) d(100)
const slots: TabSlot[] = [
  { id: "a", left: 0, width: 100 },
  { id: "b", left: 100, width: 150 },
  { id: "c", left: 250, width: 100 },
  { id: "d", left: 350, width: 100 },
];

describe("tab dragging", () => {
  it("clamps the dragged tab to the strip", () => {
    assert.equal(clampDragOffset(slots, 1, -500), -100);
    assert.equal(clampDragOffset(slots, 1, 500), 200);
    assert.equal(clampDragOffset(slots, 1, 30), 30);
  });

  it("targets a slot once the leading edge passes a neighbour's middle", () => {
    assert.equal(getDragTargetIndex(slots, 1, 0), 1);
    // b's right edge (250) must pass c's middle (300).
    assert.equal(getDragTargetIndex(slots, 1, 49), 1);
    assert.equal(getDragTargetIndex(slots, 1, 51), 2);
    // Wider than its neighbours, b still reaches the end once clamped.
    assert.equal(getDragTargetIndex(slots, 1, 200), 3);
    // b's left edge (100) must pass a's middle (50).
    assert.equal(getDragTargetIndex(slots, 1, -49), 1);
    assert.equal(getDragTargetIndex(slots, 1, -51), 0);
  });

  it("moves the tabs between the source and target aside", () => {
    assert.deepEqual(
      [0, 2, 3].map((index) => getTabShift(index, 1, 3, 150)),
      [0, -150, -150]
    );
    assert.deepEqual(
      [0, 2, 3].map((index) => getTabShift(index, 3, 0, 100)),
      [100, 100, 0]
    );
  });

  it("drops the tab exactly onto its target slot", () => {
    assert.equal(getDropOffset(slots, 1, 3), 200);
    assert.equal(getDropOffset(slots, 3, 0), -350);
    assert.equal(getDropOffset(slots, 2, 2), 0);
  });

  it("reorders the visible tabs and keeps overflowed ones in place", () => {
    const order = moveItem(["a", "b", "c"], 0, 2);
    assert.deepEqual(order, ["b", "c", "a"]);
    assert.deepEqual(applyVisibleOrder(["a", "x", "b", "c", "y"], order), [
      "b",
      "x",
      "c",
      "a",
      "y",
    ]);
  });
});
