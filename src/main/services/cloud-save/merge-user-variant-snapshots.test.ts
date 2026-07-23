import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LocalGameSnapshotContext, UserVariantSnapshotFile } from "@types";

import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.ts";

const file = (logicalFileId: string, contentHash: string) =>
  ({
    logicalFileId,
    variantId: `variant-${logicalFileId[0]}`,
    ruleId: "rule",
    relativePath: "S0000.sl2",
    contentHash,
    sizeBytes: 4,
    locator: {
      version: 1,
      ruleId: "rule",
      rawRule: "<winAppData>/Sekiro/<storeUserId>",
      ruleSource: "test",
      rootKind: "winAppData",
      targetSemantics: "directory-tree",
      bindings: {
        store: "steam",
        storeGameId: "814380",
        storeUser: {
          kind: "opaque-folder",
          store: "steam",
          concreteFolderId: logicalFileId,
        },
      },
    },
  }) satisfies UserVariantSnapshotFile;

const local = (files: UserVariantSnapshotFile[]) =>
  ({
    files,
    coverage: [],
  }) as unknown as LocalGameSnapshotContext;

describe("variant-aware Cloud Save merge", () => {
  it("merges independent user changes without a whole-game conflict", () => {
    const result = mergeUserVariantSnapshots({
      local: local([file("A", "local-a"), file("B", "base-b")]),
      remoteFiles: [file("A", "base-a"), file("B", "remote-b")],
      base: {
        schemaVersion: 3,
        environmentId: "environment",
        baseSnapshotId: "base",
        baseHeadRevision: 1,
        baseAggregateHash: "base",
        entries: [
          { logicalFileId: "A", contentHash: "base-a", sizeBytes: 4 },
          { logicalFileId: "B", contentHash: "base-b", sizeBytes: 4 },
        ],
        unresolvedRemoteEntryIds: [],
        updatedAt: "2026-07-22T00:00:00.000Z",
      },
    });

    assert.deepEqual(
      result.files.map(({ logicalFileId, contentHash }) => [
        logicalFileId,
        contentHash,
      ]),
      [
        ["A", "local-a"],
        ["B", "remote-b"],
      ]
    );
    assert.deepEqual(result.restoreEntryIds, ["B"]);
    assert.deepEqual(result.conflicts, []);
  });

  it("retains a remote-only variant and marks it unresolved", () => {
    const result = mergeUserVariantSnapshots({
      local: local([file("A", "same")]),
      remoteFiles: [file("A", "same"), file("B", "remote")],
      base: null,
    });

    assert.deepEqual(
      result.files.map((item) => item.logicalFileId),
      ["A", "B"]
    );
    assert.deepEqual(result.unresolvedRemoteEntryIds, ["B"]);
    assert.equal(result.partial, true);
  });

  it("conflicts only the logical entry changed differently", () => {
    const result = mergeUserVariantSnapshots({
      local: local([file("A", "local"), file("B", "same")]),
      remoteFiles: [file("A", "remote"), file("B", "same")],
      base: null,
    });
    assert.deepEqual(
      result.conflicts.map((item) => item.logicalFileId),
      ["A"]
    );
  });

  it("retains but does not restore an entry whose local hash failed", () => {
    const context = local([]);
    context.coverage = [
      {
        candidateId: "candidate",
        ruleId: "rule",
        variantId: "variant-B",
        logicalFileId: "B",
        authority: "inferred",
        outcome: "partial",
        enumeratedCompletely: false,
        warningCodes: ["file-hash-failed"],
      },
    ];

    const result = mergeUserVariantSnapshots({
      local: context,
      remoteFiles: [file("B", "remote")],
      base: null,
    });

    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, ["B"]);
    assert.equal(result.partial, true);
  });
});
