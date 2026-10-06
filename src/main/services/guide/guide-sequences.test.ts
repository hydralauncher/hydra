import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  GUIDE_DOUBLE_PRESS_WINDOW_MS,
  GuideSequenceDetector,
} from "./guide-sequences.js";

const WINDOW = GUIDE_DOUBLE_PRESS_WINDOW_MS;

describe("GuideSequenceDetector", () => {
  it("does not act on the first press immediately", () => {
    const detector = new GuideSequenceDetector();

    assert.equal(detector.press("pad-a", 1_000), null);
    assert.equal(detector.hasPendingPress, true);
  });

  it("runs the single action once the window has elapsed", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 1_000);

    assert.equal(detector.resolve(1_000 + WINDOW - 1), null);
    assert.equal(detector.resolve(1_000 + WINDOW), "single");
  });

  it("runs the single action only once", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 0);

    assert.equal(detector.resolve(WINDOW), "single");
    assert.equal(detector.resolve(WINDOW + 5_000), null);
    assert.equal(detector.hasPendingPress, false);
  });

  it("turns a second press inside the window into the double action", () => {
    const detector = new GuideSequenceDetector();

    assert.equal(detector.press("pad-a", 0), null);
    assert.equal(detector.press("pad-a", 200), "double");
  });

  it("accepts a second press exactly on the window boundary", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 0);

    assert.equal(detector.press("pad-a", WINDOW), "double");
  });

  it("never runs the single action after a double press", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 0);
    assert.equal(detector.press("pad-a", 200), "double");

    // Well past the window: nothing may still be armed for the first press.
    assert.equal(detector.resolve(10_000), null);
    assert.equal(detector.hasPendingPress, false);
  });

  it("treats presses further apart than the window as two single actions", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 0);
    assert.equal(detector.resolve(WINDOW), "single");

    assert.equal(detector.press("pad-a", 1_000), null);
    assert.equal(detector.resolve(1_000 + WINDOW), "single");
  });

  it("does not pair presses from two different controllers", () => {
    const detector = new GuideSequenceDetector();

    assert.equal(detector.press("pad-a", 0), null);
    assert.equal(detector.press("pad-b", 50), null);
    assert.equal(detector.hasPendingPress, true);

    // Both are single presses, so the window resolves them as one action rather
    // than as a double press.
    assert.equal(detector.resolve(WINDOW + 50), "single");
  });

  it("keeps one controller's pending press when the other completes a double", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 0);
    detector.press("pad-b", 10);

    assert.equal(detector.press("pad-b", 110), "double");
    assert.equal(detector.hasPendingPress, true, "pad-a is still armed");
    assert.equal(detector.resolve(WINDOW), "single");
  });

  it("reports how long the earliest action still has to wait", () => {
    const detector = new GuideSequenceDetector();

    assert.equal(detector.remainingMs(0), null);

    detector.press("pad-a", 1_000);
    assert.equal(detector.remainingMs(1_000), WINDOW);
    assert.equal(detector.remainingMs(1_200), WINDOW - 200);

    detector.press("pad-b", 1_250);
    assert.equal(detector.remainingMs(1_300), WINDOW - 300);
    assert.equal(detector.remainingMs(9_999), 0);
  });

  it("forgets everything on reset", () => {
    const detector = new GuideSequenceDetector();

    detector.press("pad-a", 0);
    detector.reset();

    assert.equal(detector.hasPendingPress, false);
    assert.equal(detector.resolve(10_000), null);
  });

  it("honours a custom window", () => {
    const detector = new GuideSequenceDetector(100);

    detector.press("pad-a", 0);
    assert.equal(
      detector.press("pad-a", 150),
      null,
      "outside the 100 ms window"
    );
    assert.equal(detector.press("pad-a", 200), "double");
  });
});
