import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  cloudSaveFileKey,
  validateRemoteSnapshotSummary,
  validateRestoreManifest,
} from "./cloud-save-contract.ts";

const firstVariantId = "1".repeat(64);
const secondVariantId = "2".repeat(64);
const file = (variantId: string) => ({
  variantId,
  rawPath: "<winAppData>/Sekiro/<storeUserId>",
  relativePath: "S0000.sl2",
  hash: "a".repeat(64),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
});

describe("Cloud Save launcher API contract", () => {
  it("accepts the active snapshot summary and complete manifest DTOs", () => {
    const summary = validateRemoteSnapshotSummary({
      id: "snapshot",
      version: 3,
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z",
      fileCount: 2,
      totalSizeBytes: 8,
      aggregateHash: "b".repeat(64),
    });
    const manifest = validateRestoreManifest({
      snapshot: {
        id: "snapshot",
        version: 3,
        shop: "steam",
        objectId: "814380",
      },
      variants: [
        {
          variantId: firstVariantId,
          kind: "steam-account",
          steamId64: "76561197960278073",
        },
        {
          variantId: secondVariantId,
          kind: "steam-account",
          steamId64: "76561198051718575",
        },
      ],
      files: [file(firstVariantId), file(secondVariantId)],
    });

    assert.equal(summary.version, 3);
    assert.equal(manifest.files.length, 2);
    assert.notEqual(
      cloudSaveFileKey(manifest.files[0]),
      cloudSaveFileKey(manifest.files[1])
    );
  });

  it("rejects legacy head, revision and locator fields", () => {
    assert.throws(() =>
      validateRemoteSnapshotSummary({
        id: "snapshot",
        version: 3,
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z",
        fileCount: 1,
        totalSizeBytes: 4,
        aggregateHash: "b".repeat(64),
        revision: 3,
      })
    );
    assert.throws(() =>
      validateRestoreManifest({
        snapshot: {
          id: "snapshot",
          version: 3,
          shop: "steam",
          objectId: "814380",
        },
        variants: [{ variantId: firstVariantId, kind: "default" }],
        files: [{ ...file(firstVariantId), locator: {}, logicalFileId: "old" }],
      })
    );
  });

  it("rejects unused variants and duplicate composite entries", () => {
    const base = {
      snapshot: {
        id: "snapshot",
        version: 1,
        shop: "steam",
        objectId: "814380",
      },
      variants: [
        { variantId: firstVariantId, kind: "default" },
        {
          variantId: secondVariantId,
          kind: "opaque-folder",
          concreteFolderId: "Goldberg",
        },
      ],
    };
    assert.throws(() =>
      validateRestoreManifest({
        ...base,
        files: [file(firstVariantId)],
      })
    );
    assert.throws(() =>
      validateRestoreManifest({
        ...base,
        files: [
          file(firstVariantId),
          file(secondVariantId),
          file(secondVariantId),
        ],
      })
    );
  });
});
