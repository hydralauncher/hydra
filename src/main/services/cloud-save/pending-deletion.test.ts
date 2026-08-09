import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cloudSavePendingDeletionStorageKey,
  resolveCloudSavePendingDeletionPhase,
} from "./pending-deletion-state.ts";

describe("cloud save pending deletion state", () => {
  it("uses a stable per-user game key", () => {
    const key = cloudSavePendingDeletionStorageKey("user", "steam", "game");

    assert.equal(key, JSON.stringify(["user", "steam", "game"]));
    assert.notEqual(
      key,
      cloudSavePendingDeletionStorageKey("other", "steam", "game")
    );
    assert.notEqual(
      key,
      cloudSavePendingDeletionStorageKey("user", "steam", "other")
    );
  });

  it("accepts both persisted phases", () => {
    assert.equal(
      resolveCloudSavePendingDeletionPhase({
        schemaVersion: 1,
        phase: "prepared",
      }),
      "prepared"
    );
    assert.equal(
      resolveCloudSavePendingDeletionPhase({
        schemaVersion: 1,
        phase: "remote-started",
      }),
      "remote-started"
    );
    assert.equal(resolveCloudSavePendingDeletionPhase(undefined), null);
  });

  it("treats malformed persisted state as remote-started", () => {
    for (const value of [null, false, {}, { schemaVersion: 2 }, "prepared"]) {
      assert.equal(
        resolveCloudSavePendingDeletionPhase(value),
        "remote-started"
      );
    }
  });
});
