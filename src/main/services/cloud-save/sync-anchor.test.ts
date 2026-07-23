import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canMigrateLegacyCloudSaveAnchor } from "./sync-anchor-policy.ts";

const anchor = {
  baseSnapshotId: "snapshot",
  baseAggregateHash: "base",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

describe("legacy cloud save anchor migration", () => {
  it("never guesses an aggregate-only anchor into V3 entry truth", () => {
    assert.equal(canMigrateLegacyCloudSaveAnchor(anchor, "base", 1), false);
    assert.equal(canMigrateLegacyCloudSaveAnchor(anchor, "other", 1), false);
    assert.equal(canMigrateLegacyCloudSaveAnchor(anchor, "base", 0), false);
    assert.equal(canMigrateLegacyCloudSaveAnchor(null, "base", 1), false);
  });
});
