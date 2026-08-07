import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveUnresolvedCustomPath,
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

const unresolvedCustomPath = (
  rawPath: string,
  overrides: Partial<CloudSaveUnresolvedCustomPath> = {}
): CloudSaveUnresolvedCustomPath => ({
  rawPath,
  pathHint: null,
  state: "needs-confirmation",
  reason: "legacy",
  registered: true,
  ...overrides,
});

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

  it("shows different custom raw paths as separate files", () => {
    const local = {
      ...file(firstVariantId, "l"),
      rawPath: "<custom><windows><winAppData>/Game",
    };
    const remote = {
      ...file(firstVariantId, "r"),
      rawPath: "<custom><windows>C:/Users/Rodrigo/AppData/Roaming/Game",
    };
    const oneFileSummary = {
      ...summary,
      fileCount: 1,
      totalSizeBytes: 4,
    };
    const details = buildCloudSaveV2FileDetails({
      state: "conflict",
      localVariants: [variants[0]],
      localFiles: [local],
      localSourceFiles: [source(local)],
      localTotalSizeBytes: 4,
      activeSnapshot: oneFileSummary,
      remoteVariants: [variants[0]],
      remoteFiles: [remote],
      conflictEntryIds: [cloudSaveFileKey(remote)],
    });

    assert.equal(details.comparisons.length, 2);
    assert.deepEqual(details.comparisons.map(({ status }) => status).sort(), [
      "local-only",
      "remote-only",
    ]);
    assert.deepEqual(details.unresolvedCustomPaths, [
      unresolvedCustomPath(remote.rawPath, {
        pathHint: "C:/Users/Rodrigo/AppData/Roaming/Game",
        registered: false,
      }),
    ]);
  });

  it("preserves every stored unresolved binding without hiding current paths", () => {
    const legacy = unresolvedCustomPath(
      "<custom><linux>/home/hydra/.local/share/game"
    );
    const current = unresolvedCustomPath(
      "<custom><linux><home>/.local/share/game",
      {
        state: "recoverable",
        reason: "environment-unavailable",
      }
    );
    const details = buildCloudSaveV2FileDetails({
      state: "untracked",
      localVariants: [],
      localFiles: [],
      localSourceFiles: [],
      localTotalSizeBytes: 0,
      activeSnapshot: null,
      remoteVariants: [],
      remoteFiles: [],
      unresolvedCustomPaths: [legacy, current],
    });

    assert.deepEqual(details.unresolvedCustomPaths, [legacy, current]);
  });

  it("exposes a current remote-only custom path as unregistered", () => {
    const remote = {
      ...file(firstVariantId, "r"),
      rawPath: "<custom><windows><winDocuments>/Game",
    };
    const details = buildCloudSaveV2FileDetails({
      state: "remote-ahead",
      localVariants: [],
      localFiles: [],
      localSourceFiles: [],
      localTotalSizeBytes: 0,
      activeSnapshot: {
        ...summary,
        fileCount: 1,
        totalSizeBytes: 4,
      },
      remoteVariants: [variants[0]],
      remoteFiles: [remote],
    });

    assert.deepEqual(details.unresolvedCustomPaths, [
      unresolvedCustomPath(remote.rawPath, {
        reason: "unregistered",
        registered: false,
      }),
    ]);
  });

  it("accepts equivalent default variants from N-API and the API", () => {
    const napiVariant = {
      variantId: firstVariantId,
      kind: "default",
      steamId64: null,
      concreteFolderId: null,
    } as unknown as SnapshotVariant;
    const apiVariant: SnapshotVariant = {
      variantId: firstVariantId,
      kind: "default",
    };

    assert.doesNotThrow(() =>
      buildCloudSaveV2FileDetails({
        state: "untracked",
        localVariants: [napiVariant],
        localFiles: [],
        localSourceFiles: [],
        localTotalSizeBytes: 0,
        activeSnapshot: null,
        remoteVariants: [apiVariant],
        remoteFiles: [],
      })
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
          customPathRawPaths: [],
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
          customPathRawPaths: [],
          variants,
          files: [file(firstVariantId, "a"), file(secondVariantId, "a")],
        })
      )
    );
  });
});
