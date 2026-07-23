import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canMigrateLegacyCloudSaveAnchor,
  hasCloudSaveV4AnchorSchema,
} from "./sync-anchor-policy.ts";

const anchor = {
  baseSnapshotId: "snapshot",
  baseAggregateHash: "base",
  updatedAt: "2026-07-20T00:00:00.000Z",
};

describe("legacy cloud save anchor invalidation", () => {
  it("never guesses an older anchor into V4 composite entry truth", () => {
    assert.equal(canMigrateLegacyCloudSaveAnchor(anchor, "base", 1), false);
    assert.equal(canMigrateLegacyCloudSaveAnchor(anchor, "other", 1), false);
    assert.equal(canMigrateLegacyCloudSaveAnchor(anchor, "base", 0), false);
    assert.equal(canMigrateLegacyCloudSaveAnchor(null, "base", 1), false);
  });

  it("accepts only the V4 schema marker", () => {
    assert.equal(hasCloudSaveV4AnchorSchema({ schemaVersion: 4 }), true);
    assert.equal(hasCloudSaveV4AnchorSchema({ schemaVersion: 3 }), false);
    assert.equal(hasCloudSaveV4AnchorSchema(anchor), false);
  });
});
