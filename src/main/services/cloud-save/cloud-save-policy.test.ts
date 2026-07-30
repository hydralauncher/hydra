import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getSuggestedCloudSaveAction,
  getSyncAction,
  getSyncDirection,
  hasRemoteChangedSinceBase,
} from "./sync-game/policy.ts";

describe("cloud save automatic sync policy", () => {
  it("syncs bidirectionally when the execution environment changes", () => {
    assert.equal(getSyncDirection("environment-changed"), "bidirectional");
    assert.equal(getSyncAction("environment-changed", "local-ahead"), "upload");
    assert.equal(
      getSyncAction("environment-changed", "remote-ahead"),
      "restore"
    );
    assert.equal(getSyncAction("environment-changed", "conflict"), "conflict");
    assert.equal(getSyncAction("environment-changed", "synced"), "none");
  });

  it("syncs bidirectionally when the game page opens", () => {
    assert.equal(getSyncDirection("game-page-open"), "bidirectional");
    assert.equal(getSyncAction("game-page-open", "local-ahead"), "upload");
    assert.equal(getSyncAction("game-page-open", "remote-ahead"), "restore");
    assert.equal(getSyncAction("game-page-open", "conflict"), "conflict");
    assert.equal(getSyncAction("game-page-open", "synced"), "none");
  });

  it("keeps pre-launch restore-only and post-exit upload-only", () => {
    assert.equal(getSyncDirection("pre-launch"), "restore-only");
    assert.equal(getSyncAction("pre-launch", "local-ahead"), "none");
    assert.equal(getSyncAction("pre-launch", "remote-ahead"), "restore");
    assert.equal(getSyncDirection("custom-path-rebind"), "restore-only");
    assert.equal(getSyncAction("custom-path-rebind", "local-ahead"), "none");
    assert.equal(
      getSyncAction("custom-path-rebind", "remote-ahead"),
      "restore"
    );

    assert.equal(getSyncDirection("post-exit"), "upload-only");
    assert.equal(getSyncAction("post-exit", "remote-ahead"), "none");
    assert.equal(getSyncAction("manual", "local-ahead"), "upload");
    assert.equal(getSyncAction("post-exit", "local-ahead"), "upload");
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
