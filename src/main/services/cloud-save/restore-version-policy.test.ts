import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getRestoreVersionDecision } from "./restore-version-policy.ts";

describe("Cloud Save restore version policy", () => {
  const expected = { id: "snapshot", version: 3 };

  it("applies a restore only while the active version is stable", () => {
    assert.equal(getRestoreVersionDecision(expected, expected, 0), "stable");
  });

  it("restarts once after a version change", () => {
    assert.equal(
      getRestoreVersionDecision(expected, { id: "snapshot", version: 4 }, 0),
      "retry"
    );
  });

  it("aborts after a second change or a missing snapshot", () => {
    assert.equal(
      getRestoreVersionDecision(expected, { id: "snapshot", version: 5 }, 1),
      "abort"
    );
    assert.equal(getRestoreVersionDecision(expected, null, 0), "abort");
  });
});
