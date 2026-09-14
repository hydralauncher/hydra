import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  LocalGameSnapshotContext,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { resolveAnalyzedCloudSaveMerge } from "./resolve-analyzed-cloud-save-merge.ts";

const variantId = "1".repeat(64);
const variant: SnapshotVariant = { variantId, kind: "default" };
const hash = (value: string) => value.repeat(64).slice(0, 64);
const file = (
  relativePath: string,
  value: string,
  rawPath: string
): SnapshotFile => ({
  variantId,
  rawPath,
  relativePath,
  hash: hash(value),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
});

const context = (files: SnapshotFile[]): LocalGameSnapshotContext =>
  ({
    gameId: { shop: "steam", objectId: "1" },
    ruleSourceRevision: "rules",
    discoveryEngineVersion: 3,
    coverage: [
      {
        candidateId: "installation",
        ruleId: "custom",
        variantId,
        rawPath: "<custom>/installation",
        selectedRoot: true,
        authority: "exact",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ],
    variants: [variant],
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, item) => total + item.sizeBytes, 0),
    files,
    aggregateHash: hash("f"),
    sourceFiles: [],
    environmentId: "environment",
    customPathRawPaths: ["<custom>/installation"],
    pathContext: {
      shop: "steam",
      objectId: "1",
      platform: "windows",
      homeDir: "C:/Users/Hydra",
      storeUserContext: { known: [] },
    },
  }) as LocalGameSnapshotContext;

describe("resolved cloud save merge", () => {
  it("preserves installation-owned missing files while resolving another conflict", () => {
    const protectedFile = file("protected.sav", "p", "<custom>/installation");
    const baseConflict = file("conflict.sav", "a", "<home>/game");
    const localConflict = file("conflict.sav", "l", "<home>/game");
    const remoteConflict = file("conflict.sav", "r", "<home>/game");
    const analysis = {
      merge: {
        variants: [variant],
        files: [protectedFile, localConflict],
        conflicts: [
          {
            entryId: cloudSaveFileKey(baseConflict),
            local: localConflict,
            remote: remoteConflict,
          },
        ],
        restoreEntryIds: [cloudSaveFileKey(protectedFile)],
        deleteRemoteEntryIds: [],
        deleteLocalEntryIds: [],
        unresolvedRemoteEntryIds: [],
        partial: false,
      },
      localSnapshotContext: context([localConflict]),
      remoteManifest: {
        customPathRawPaths: [protectedFile.rawPath],
        variants: [variant],
        files: [protectedFile, remoteConflict],
      },
      anchor: {
        schemaVersion: 4,
        environmentId: "environment",
        baseSnapshotId: "snapshot",
        baseVersion: 1,
        baseAggregateHash: hash("b"),
        entries: [protectedFile, baseConflict].map(
          ({ lastModifiedAt: _, ...entry }) => entry
        ),
        unresolvedRemoteEntryIds: [],
        updatedAt: "2026-07-22T10:00:00.000Z",
      },
      syncDirection: "bidirectional",
      pendingCustomPathRawPaths: [],
      installationOwnedCustomPathRawPaths: [protectedFile.rawPath],
    } as Parameters<typeof resolveAnalyzedCloudSaveMerge>[0];

    const result = resolveAnalyzedCloudSaveMerge(analysis, "keep-local");

    assert.ok(
      result.files.some(
        (candidate) =>
          cloudSaveFileKey(candidate) === cloudSaveFileKey(protectedFile)
      )
    );
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(protectedFile)]);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
  });
});
