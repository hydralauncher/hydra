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
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.ts";

const variantId = "1".repeat(64);
const variant: SnapshotVariant = { variantId, kind: "default" };
const hash = (value: string) => value.repeat(64).slice(0, 64);
const file = (
  relativePath: string,
  value: string,
  rawPath = "<home>/game"
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
    discoveryEngineVersion: 2,
    coverage: [],
    variants: [variant],
    fileCount: files.length,
    totalSizeBytes: files.reduce((total, item) => total + item.sizeBytes, 0),
    files,
    aggregateHash: hash("f"),
    sourceFiles: [],
    environmentId: "environment",
    pathContext: {
      shop: "steam",
      objectId: "1",
      platform: "windows",
      homeDir: "C:/Users/Hydra",
      storeUserContext: { known: [] },
    },
  }) as LocalGameSnapshotContext;

const anchor = (files: SnapshotFile[]) => ({
  schemaVersion: 4 as const,
  environmentId: "environment",
  baseSnapshotId: "snapshot",
  baseVersion: 1,
  baseAggregateHash: hash("b"),
  entries: files.map(({ lastModifiedAt: _, ...entry }) => entry),
  unresolvedRemoteEntryIds: [],
  updatedAt: "2026-07-22T10:00:00.000Z",
});

describe("merge user variant snapshots", () => {
  it("combines independent local and remote changes", () => {
    const base = [file("A.sav", "a"), file("B.sav", "b")];
    const result = mergeUserVariantSnapshots({
      local: context([file("A.sav", "c"), file("B.sav", "b")]),
      remoteVariants: [variant],
      remoteFiles: [file("A.sav", "a"), file("B.sav", "d")],
      base: anchor(base),
    });

    assert.deepEqual(
      result.files.map((item) => [item.relativePath, item.hash]),
      [
        ["A.sav", hash("c")],
        ["B.sav", hash("d")],
      ]
    );
    assert.deepEqual(result.restoreEntryIds, [
      cloudSaveFileKey(file("B.sav", "d")),
    ]);
    assert.equal(result.conflicts.length, 0);
  });

  it("preserves and schedules remote-only entries for restore", () => {
    const remote = file("remote.sav", "r");
    const result = mergeUserVariantSnapshots({
      local: context([]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(result.files, [remote]);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(remote)]);
    assert.deepEqual(result.unresolvedRemoteEntryIds, [
      cloudSaveFileKey(remote),
    ]);
  });

  it("does not infer a restore from incomplete local coverage", () => {
    const remote = file("remote.sav", "r");
    const local = context([]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: remote.rawPath,
        authority: "authoritative",
        outcome: "partial",
        enumeratedCompletely: false,
        warningCodes: ["partial"],
      },
    ];
    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: null,
    });

    assert.deepEqual(result.restoreEntryIds, []);
    assert.equal(result.partial, true);
    assert.deepEqual(result.files, [remote]);
  });

  it("conflicts only when both sides changed the same composite entry", () => {
    const base = file("slot.sav", "a");
    const local = file("slot.sav", "l");
    const remote = file("slot.sav", "r");
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([base]),
    });

    assert.deepEqual(
      result.conflicts.map((item) => item.entryId),
      [cloudSaveFileKey(remote)]
    );
    assert.deepEqual(result.files, [remote]);
  });

  it("applies keep-local to the actual conflicting composite entry", () => {
    const base = file("slot.sav", "a");
    const local = file("slot.sav", "l");
    const remote = file("slot.sav", "r");
    const entryId = cloudSaveFileKey(remote);
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [variant],
      remoteFiles: [remote],
      base: anchor([base]),
      resolutions: new Map([[entryId, "keep-local"]]),
    });

    assert.deepEqual(result.files, [local]);
    assert.equal(result.conflicts.length, 0);
  });
});
