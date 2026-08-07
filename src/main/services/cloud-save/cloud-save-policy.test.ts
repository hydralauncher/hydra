import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSuggestedCloudSaveAction,
  getSyncDirection,
  hasRemoteChangedSinceBase,
} from "./sync-game/policy.ts";

describe("cloud save automatic sync policy", () => {
  it("syncs bidirectionally when the execution environment changes", () => {
    assert.equal(getSyncDirection("environment-changed"), "bidirectional");
  });

  it("syncs bidirectionally when the game page opens", () => {
    assert.equal(getSyncDirection("game-page-open"), "bidirectional");
  });

  it("keeps pre-launch restore-only and post-exit upload-only", () => {
    assert.equal(getSyncDirection("pre-launch"), "restore-only");
    assert.equal(getSyncDirection("custom-path-rebind"), "restore-only");
    assert.equal(getSyncDirection("post-exit"), "upload-only");
  });

  it("detects a remote created or changed during the game session", () => {
    assert.equal(hasRemoteChangedSinceBase("remote", null), true);
    assert.equal(hasRemoteChangedSinceBase("new", "old"), true);
    assert.equal(hasRemoteChangedSinceBase("same", "same"), false);
  });

  it("describes the action a manual sync will perform", () => {
    assert.equal(getSuggestedCloudSaveAction("local-ahead", 0), "upload");
    assert.equal(getSuggestedCloudSaveAction("local-ahead", 1), "merge");
    assert.equal(getSuggestedCloudSaveAction("remote-ahead", 1), "restore");
    assert.equal(getSuggestedCloudSaveAction("conflict", 0), "conflict");
    assert.equal(getSuggestedCloudSaveAction("partial", 0), "none");
    assert.equal(getSuggestedCloudSaveAction("synced", 0), "none");
    assert.equal(getSuggestedCloudSaveAction("untracked", 0), "none");
  });
});
