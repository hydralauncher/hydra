import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSyncAction,
  hasRemoteChangedSinceBase,
} from "./sync-game/policy.ts";

describe("cloud save automatic sync policy", () => {
  it("never uploads when the execution environment changes", () => {
    assert.equal(getSyncAction("environment-changed", "local-ahead"), "none");
    assert.equal(
      getSyncAction("environment-changed", "remote-ahead"),
      "restore"
    );
  });

  it("keeps manual and post-exit upload behavior", () => {
    assert.equal(getSyncAction("manual", "local-ahead"), "upload");
    assert.equal(getSyncAction("post-exit", "local-ahead"), "upload");
  });

  it("detects a remote created or changed during the game session", () => {
    assert.equal(hasRemoteChangedSinceBase("remote", null), true);
    assert.equal(hasRemoteChangedSinceBase("new", "old"), true);
    assert.equal(hasRemoteChangedSinceBase("same", "same"), false);
  });
});
