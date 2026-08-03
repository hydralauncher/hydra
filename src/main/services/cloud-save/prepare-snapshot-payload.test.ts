import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { buildPrepareSnapshotPayload } from "./prepare-snapshot-payload.ts";

const variant = { variantId: "1".repeat(64), kind: "default" as const };
const file = {
  variantId: variant.variantId,
  rawPath: "<home>/game",
  relativePath: "save.dat",
  hash: "a".repeat(64),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
};

describe("prepare snapshot payload", () => {
  it("uses baseVersion 0 when there is no active snapshot", () => {
    const payload = buildPrepareSnapshotPayload({
      shop: "steam",
      objectId: "1",
      platform: "windows",
      snapshotHash: "b".repeat(64),
      baseVersion: 0,
      customPathRawPaths: [],
      variants: [variant],
      files: [file],
    });

    assert.equal(payload.baseVersion, 0);
    assert.deepEqual(Object.keys(payload).sort(), [
      "baseVersion",
      "customPathRawPaths",
      "files",
      "objectId",
      "platform",
      "shop",
      "snapshotHash",
      "variants",
    ]);
  });

  it("uses the current active version and includes hostname", () => {
    const payload = buildPrepareSnapshotPayload({
      shop: "steam",
      objectId: "1",
      platform: "linux",
      hostname: "deck",
      snapshotHash: "b".repeat(64),
      baseVersion: 7,
      customPathRawPaths: [],
      variants: [variant],
      files: [file],
    });

    assert.equal(payload.baseVersion, 7);
    assert.equal(payload.hostname, "deck");
  });

  it("rejects duplicate default variants before preparing the request", () => {
    assert.throws(
      () =>
        buildPrepareSnapshotPayload({
          shop: "steam",
          objectId: "1",
          platform: "windows",
          snapshotHash: "b".repeat(64),
          baseVersion: 1,
          customPathRawPaths: [],
          variants: [variant, { variantId: "2".repeat(64), kind: "default" }],
          files: [file],
        }),
      /Duplicate default Cloud Save variant/
    );
  });

  it("rejects files that reference a missing variant", () => {
    assert.throws(
      () =>
        buildPrepareSnapshotPayload({
          shop: "steam",
          objectId: "1",
          platform: "windows",
          snapshotHash: "b".repeat(64),
          baseVersion: 1,
          customPathRawPaths: [],
          variants: [variant],
          files: [{ ...file, variantId: "2".repeat(64) }],
        }),
      /Cloud Save file references an unknown variant/
    );
  });
});
