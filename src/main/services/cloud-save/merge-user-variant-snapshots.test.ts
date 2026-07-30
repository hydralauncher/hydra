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

  it("restores everything when the local snapshot is empty", () => {
    const remote = file("remote.sav", "r");
    const local = context([]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: remote.rawPath,
        selectedRoot: true,
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

    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(remote)]);
    assert.equal(result.partial, true);
    assert.deepEqual(result.files, [remote]);
  });

  it("propagates a proven local deletion to the remote snapshot", () => {
    const deleted = file("deleted.sav", "a");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: deleted.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [deleted, retained],
      base: anchor([deleted, retained]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteRemoteEntryIds, [cloudSaveFileKey(deleted)]);
    assert.deepEqual(result.restoreEntryIds, []);
  });

  it("restores instead of deleting when the root is missing", () => {
    const missing = file("missing.sav", "a");
    const retained = file("retained.sav", "b", "<home>/other");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: missing.rawPath,
        selectedRoot: false,
        authority: "authoritative",
        outcome: "confirmed-missing",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [missing, retained],
      base: anchor([missing, retained]),
    });

    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(missing)]);
  });

  it("preserves remote data without restoring when coverage is incomplete", () => {
    const remote = file("remote.sav", "a");
    const retained = file("retained.sav", "b", "<home>/other");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: remote.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "partial",
        enumeratedCompletely: false,
        warningCodes: ["filesystem-error"],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote, retained],
      base: anchor([remote, retained]),
    });

    assert.deepEqual(result.files, [remote, retained]);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.equal(result.partial, true);
  });

  it("conflicts when a locally deleted file changed remotely", () => {
    const base = file("slot.sav", "a");
    const remote = file("slot.sav", "r");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: base.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [remote, retained],
      base: anchor([base, retained]),
    });

    assert.deepEqual(result.conflicts, [
      { entryId: cloudSaveFileKey(remote), local: null, remote },
    ]);
  });

  it("resolves deletion conflicts using the selected side", () => {
    const base = file("slot.sav", "a");
    const remote = file("slot.sav", "r");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: base.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];
    const entryId = cloudSaveFileKey(remote);
    const input = {
      local,
      remoteVariants: [variant],
      remoteFiles: [remote, retained],
      base: anchor([base, retained]),
    };

    const keepLocal = mergeUserVariantSnapshots({
      ...input,
      resolutions: new Map([[entryId, "keep-local"]]),
    });
    const keepRemote = mergeUserVariantSnapshots({
      ...input,
      resolutions: new Map([[entryId, "keep-remote"]]),
    });

    assert.deepEqual(keepLocal.deleteRemoteEntryIds, [entryId]);
    assert.deepEqual(keepLocal.restoreEntryIds, []);
    assert.deepEqual(keepRemote.deleteRemoteEntryIds, []);
    assert.deepEqual(keepRemote.restoreEntryIds, [entryId]);
  });

  it("applies a remote deletion to an unchanged local file", () => {
    const deleted = file("deleted.sav", "a");
    const retained = file("retained.sav", "b");
    const result = mergeUserVariantSnapshots({
      local: context([deleted, retained]),
      remoteVariants: [variant],
      remoteFiles: [retained],
      base: anchor([deleted, retained]),
    });

    assert.deepEqual(result.files, [retained]);
    assert.deepEqual(result.deleteLocalEntryIds, [cloudSaveFileKey(deleted)]);
  });

  it("conflicts when a remotely deleted file changed locally", () => {
    const base = file("slot.sav", "a");
    const local = file("slot.sav", "l");
    const result = mergeUserVariantSnapshots({
      local: context([local]),
      remoteVariants: [],
      remoteFiles: [],
      base: anchor([base]),
    });

    assert.deepEqual(result.conflicts, [
      { entryId: cloudSaveFileKey(local), local, remote: null },
    ]);
  });

  it("keeps pre-launch restore-only when a local file was deleted", () => {
    const deleted = file("deleted.sav", "a");
    const retained = file("retained.sav", "b");
    const local = context([retained]);
    local.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId,
        rawPath: deleted.rawPath,
        selectedRoot: true,
        authority: "authoritative",
        outcome: "scanned",
        enumeratedCompletely: true,
        warningCodes: [],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local,
      remoteVariants: [variant],
      remoteFiles: [deleted, retained],
      base: anchor([deleted, retained]),
      direction: "restore-only",
    });

    assert.deepEqual(result.deleteRemoteEntryIds, []);
    assert.deepEqual(result.restoreEntryIds, [cloudSaveFileKey(deleted)]);
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
