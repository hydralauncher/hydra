import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addCaptureSessionReason,
  removeCaptureSessionReason,
  type CaptureSessionReason,
} from "./linux-game-capture-session-reasons.js";

describe("Linux game capture session reasons", () => {
  it("adds a reason once without changing the original set", () => {
    const original = new Set<CaptureSessionReason>(["souvenir"]);
    const added = addCaptureSessionReason(original, "screenshot");

    assert.deepEqual([...added].sort(), ["screenshot", "souvenir"]);
    assert.deepEqual([...original], ["souvenir"]);
    assert.deepEqual([...addCaptureSessionReason(added, "screenshot")].sort(), [
      "screenshot",
      "souvenir",
    ]);
  });

  it("keeps the other reason when one is removed", () => {
    const reasons = new Set<CaptureSessionReason>(["souvenir", "screenshot"]);
    const removed = removeCaptureSessionReason(reasons, "souvenir");

    assert.deepEqual([...removed], ["screenshot"]);
    assert.equal(reasons.size, 2);
  });

  it("ends up empty when the last reason is removed", () => {
    const reasons = new Set<CaptureSessionReason>(["screenshot"]);

    assert.equal(removeCaptureSessionReason(reasons, "screenshot").size, 0);
    assert.equal(removeCaptureSessionReason(reasons, "souvenir").size, 1);
  });
});
