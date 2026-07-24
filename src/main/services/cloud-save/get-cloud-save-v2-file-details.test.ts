import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  LocalGameSnapshotSourceFile,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildCloudSaveV2FileDetails,
  loadCloudSaveV2FileDetails,
} from "./cloud-save-v2-file-details.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";

const firstVariantId = "1".repeat(64);
const secondVariantId = "2".repeat(64);
const variants: SnapshotVariant[] = [
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
];
const hash = (value: string) => value.repeat(64).slice(0, 64);
const file = (variantId: string, value: string): SnapshotFile => ({
  variantId,
  rawPath: "<winAppData>/Sekiro/<storeUserId>",
  relativePath: "S0000.sl2",
  hash: hash(value),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
});
const source = (snapshotFile: SnapshotFile): LocalGameSnapshotSourceFile => ({
  variantId: snapshotFile.variantId,
  ruleId: "local-rule",
  rawPath: snapshotFile.rawPath,
  relativePath: snapshotFile.relativePath,
  absolutePath: `C:/Sekiro/${snapshotFile.variantId}/S0000.sl2`,
  hash: snapshotFile.hash,
  sizeBytes: snapshotFile.sizeBytes,
  lastModifiedAt: snapshotFile.lastModifiedAt,
  localBindings: {
    environmentId: "environment",
    rootId: "root",
    concreteUserSegment: snapshotFile.variantId,
    concretePath: `C:/Sekiro/${snapshotFile.variantId}`,
  },
  confidence: "authoritative",
  provenance: ["test"],
});
const summary = {
  id: "snapshot",
  version: 3,
  createdAt: "2026-07-20T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
  fileCount: 2,
  totalSizeBytes: 8,
  aggregateHash: "a".repeat(64),
};

describe("cloud save V2 file details", () => {
  it("keeps equal paths separated by variant and exposes active version", () => {
    const localFiles = [file(firstVariantId, "a"), file(secondVariantId, "a")];
    const details = buildCloudSaveV2FileDetails({
      state: "synced",
      localVariants: variants,
      localFiles,
      localSourceFiles: localFiles.map(source),
      localTotalSizeBytes: 8,
      activeSnapshot: summary,
      remoteVariants: variants,
      remoteFiles: localFiles,
    });

    assert.equal(details.variants.length, 2);
    assert.equal(details.activeSnapshot?.version, 3);
    assert.equal(details.activeSnapshot?.updatedAt, "2026-07-22T10:00:00.000Z");
    assert.notEqual(
      cloudSaveFileKey(localFiles[0]),
      cloudSaveFileKey(localFiles[1])
    );
  });

  it("compares conflicts using variant + rawPath + relativePath", () => {
    const localFiles = [file(firstVariantId, "l"), file(secondVariantId, "a")];
    const remoteFiles = [file(firstVariantId, "r"), file(secondVariantId, "a")];
    const details = buildCloudSaveV2FileDetails({
      state: "conflict",
      localVariants: variants,
      localFiles,
      localSourceFiles: localFiles.map(source),
      localTotalSizeBytes: 8,
      activeSnapshot: summary,
      remoteVariants: variants,
      remoteFiles,
      conflictEntryIds: [cloudSaveFileKey(remoteFiles[0])],
    });

    assert.deepEqual(
      details.comparisons.map((comparison) => comparison.status),
      ["modified", "unchanged"]
    );
    assert.equal(
      details.variants.find((variant) => variant.variantId === firstVariantId)
        ?.conflictCount,
      1
    );
  });

  it("loads and verifies the active manifest version", async () => {
    const remoteFiles = [file(firstVariantId, "a"), file(secondVariantId, "a")];
    const details = await loadCloudSaveV2FileDetails(
      {
        objectId: "814380",
        shop: "steam",
        state: "synced",
        localVariants: [],
        localFiles: [],
        localSourceFiles: [],
        localTotalSizeBytes: 0,
        activeSnapshot: summary,
      },
      async (snapshot) => {
        assert.equal(snapshot.version, 3);
        return {
          snapshot: {
            id: "snapshot",
            version: 3,
            shop: "steam",
            objectId: "814380",
          },
          variants,
          files: remoteFiles,
        };
      }
    );

    assert.equal(details.activeSnapshot?.fileCount, 2);
  });

  it("rejects a manifest from a different active version", async () => {
    await assert.rejects(() =>
      loadCloudSaveV2FileDetails(
        {
          objectId: "814380",
          shop: "steam",
          state: "synced",
          localVariants: [],
          localFiles: [],
          localSourceFiles: [],
          localTotalSizeBytes: 0,
          activeSnapshot: summary,
        },
        async () => ({
          snapshot: {
            id: "snapshot",
            version: 4,
            shop: "steam",
            objectId: "814380",
          },
          variants,
          files: [file(firstVariantId, "a"), file(secondVariantId, "a")],
        })
      )
    );
  });
});
