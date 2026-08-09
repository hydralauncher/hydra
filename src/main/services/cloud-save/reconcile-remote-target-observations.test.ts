import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  LocalGameSnapshotContext,
  ResolveRestoreTargetsResult,
  RestoreManifestFile,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { reconcileRemoteTargetObservations } from "./reconcile-remote-target-observations.ts";

const defaultVariantId = "1".repeat(64);
const nativeVariantId = "2".repeat(64);
const variants: SnapshotVariant[] = [
  { variantId: defaultVariantId, kind: "default" },
  {
    variantId: nativeVariantId,
    kind: "opaque-folder",
    concreteFolderId: "76561198000000000",
  },
];
const hash = (value: string) => value.repeat(64).slice(0, 64);
const customFile: SnapshotFile = {
  variantId: defaultVariantId,
  rawPath: "<custom><windows><winDocuments>/Stray",
  relativePath: "Data.sav",
  hash: hash("a"),
  sizeBytes: 10,
  lastModifiedAt: "2026-08-01T10:00:00.000Z",
};
const nativeFile: RestoreManifestFile = {
  variantId: nativeVariantId,
  rawPath: "<winLocalAppData>/Hk_project/Saved/SaveGames/<storeUserId>",
  relativePath: "Data.sav",
  hash: hash("a"),
  sizeBytes: 10,
  lastModifiedAt: "2026-08-01T10:00:00.000Z",
};

const context = (): LocalGameSnapshotContext => ({
  gameId: { shop: "steam", objectId: "1332010" },
  ruleSourceRevision: "rules",
  discoveryEngineVersion: 3,
  coverage: [],
  variants: [variants[0]],
  fileCount: 1,
  totalSizeBytes: customFile.sizeBytes,
  files: [customFile],
  aggregateHash: hash("f"),
  sourceFiles: [
    {
      ...customFile,
      ruleId: "custom-rule",
      absolutePath: "C:/Saves/Stray/Data.sav",
      localBindings: {
        environmentId: "environment",
        rootId: "custom-root",
        concreteUserSegment: "__unbound__",
        concretePath: "C:/Saves/Stray",
      },
      confidence: "exact",
      provenance: ["custom-rule"],
    },
  ],
  environmentId: "environment",
  customPathRawPaths: [customFile.rawPath],
  pathContext: {
    shop: "steam",
    objectId: "1332010",
    platform: "windows",
    homeDir: "C:/Users/Hydra",
    storeUserContext: { known: [] },
  },
});

const aggregate = ({ files }: { files: SnapshotFile[] }) =>
  files.length.toString(16).padStart(64, "0");

const anchor = (files: SnapshotFile[]) => ({
  schemaVersion: 4 as const,
  environmentId: "environment",
  baseSnapshotId: "snapshot",
  baseVersion: 1,
  baseAggregateHash: hash("b"),
  entries: files.map(({ lastModifiedAt: _, ...file }) => file),
  unresolvedRemoteEntryIds: [],
  updatedAt: "2026-08-01T10:00:00.000Z",
});

const resolved = (
  targetPath: string,
  observedHash = nativeFile.hash
): ResolveRestoreTargetsResult => ({
  actions: [
    {
      ...nativeFile,
      targetPath,
      restoreRootPath:
        "C:/Users/Hydra/AppData/Local/Hk_project/Saved/SaveGames/76561198000000000",
      action: observedHash === nativeFile.hash ? "skip-identical" : "replace",
      observedHash,
      observedSizeBytes: 10,
      observedLastModifiedAt: "2026-08-02T10:00:00.000Z",
    },
  ],
  blocked: [],
  deferred: [],
});

describe("remote target observation reconciliation", () => {
  it("keeps same-hash files at different paths as separate identities", () => {
    const result = reconcileRemoteTargetObservations(
      context(),
      variants,
      [nativeFile],
      resolved(
        "C:/Users/Hydra/AppData/Local/Hk_project/Saved/SaveGames/76561198000000000/Data.sav"
      ),
      aggregate
    );

    assert.equal(result.files.length, 2);
    assert.deepEqual(
      result.files.map(cloudSaveFileKey).sort(),
      [cloudSaveFileKey(customFile), cloudSaveFileKey(nativeFile)].sort()
    );
    assert.equal(result.aggregateHash, "2".padStart(64, "0"));
    const merge = mergeUserVariantSnapshots({
      local: result,
      remoteVariants: variants,
      remoteFiles: [customFile, nativeFile],
      base: anchor([customFile, nativeFile]),
    });
    assert.equal(merge.files.length, 2);
    assert.deepEqual(merge.restoreEntryIds, []);
    assert.deepEqual(merge.deleteLocalEntryIds, []);
    assert.deepEqual(merge.deleteRemoteEntryIds, []);
    assert.equal(merge.partial, false);
  });

  it("uses the current bytes when the resolved file changed locally", () => {
    const result = reconcileRemoteTargetObservations(
      context(),
      variants,
      [nativeFile],
      resolved("C:/Native/Data.sav", hash("c")),
      aggregate
    );

    const observed = result.files.find(
      (file) => cloudSaveFileKey(file) === cloudSaveFileKey(nativeFile)
    );
    assert.equal(observed?.hash, hash("c"));
    assert.equal(observed?.lastModifiedAt, "2026-08-02T10:00:00.000Z");
    const merge = mergeUserVariantSnapshots({
      local: result,
      remoteVariants: variants,
      remoteFiles: [customFile, nativeFile],
      base: anchor([customFile, nativeFile]),
    });
    assert.equal(
      merge.files.find(
        (file) => cloudSaveFileKey(file) === cloudSaveFileKey(nativeFile)
      )?.hash,
      hash("c")
    );
  });

  it("marks overlapping identities partial without adding or mutating them", () => {
    const result = reconcileRemoteTargetObservations(
      context(),
      variants,
      [nativeFile],
      resolved("C:/Saves/Stray/Data.sav"),
      aggregate
    );

    assert.deepEqual(result.files, [customFile]);
    assert.equal(
      result.coverage.some(
        (item) =>
          item.variantId === nativeFile.variantId &&
          item.outcome === "partial" &&
          item.warningCodes.includes("remote-target-identity-overlap")
      ),
      true
    );
    const merge = mergeUserVariantSnapshots({
      local: result,
      remoteVariants: variants,
      remoteFiles: [customFile, nativeFile],
      base: anchor([customFile, nativeFile]),
    });
    assert.equal(merge.partial, true);
    assert.deepEqual(merge.restoreEntryIds, []);
    assert.deepEqual(merge.deleteLocalEntryIds, []);
    assert.deepEqual(merge.deleteRemoteEntryIds, []);
  });

  it("leaves a truly missing target absent for the normal merge policy", () => {
    const result = reconcileRemoteTargetObservations(
      context(),
      variants,
      [nativeFile],
      {
        actions: [
          {
            ...nativeFile,
            targetPath: "C:/Native/Missing.sav",
            restoreRootPath: "C:/Native",
            action: "create",
          },
        ],
        blocked: [],
        deferred: [],
      },
      aggregate
    );

    assert.deepEqual(result.files, [customFile]);
  });
});
