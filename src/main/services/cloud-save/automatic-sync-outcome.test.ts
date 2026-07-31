import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifyAutomaticCloudSaveFailure } from "./automatic-sync-outcome.js";

describe("automatic cloud save sync outcome", () => {
  it("allows pre-launch failures before restore to continue offline", () => {
    assert.equal(classifyAutomaticCloudSaveFailure("pre-launch"), "offline");
    assert.equal(
      classifyAutomaticCloudSaveFailure("pre-launch", "analyzing"),
      "offline"
    );
  });

  it("blocks only after a necessary pre-launch restore starts", () => {
    assert.equal(
      classifyAutomaticCloudSaveFailure("pre-launch", "restoring"),
      "failed"
    );
    assert.equal(
      classifyAutomaticCloudSaveFailure("post-exit", "analyzing"),
      "failed"
    );
  });
});
