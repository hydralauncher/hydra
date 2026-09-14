import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveCustomPathBindings,
  CloudSaveSyncAnchor,
  LocalGameSnapshotContext,
  LocalGameSnapshotFile,
  LocalGameSnapshotSourceFile,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import {
  buildRemoteSnapshotDeletionPlan,
  decideRemoteSnapshotDeletion,
} from "./remote-snapshot-deletion.ts";

const variantId = "a".repeat(64);
const hash = (value: string) => value.repeat(64);
const file = (
  relativePath: string,
  fileHash: string,
  rawPath = "<winAppData>/Game/Saves"
): LocalGameSnapshotFile => ({
  variantId,
  rawPath,
  relativePath,
  hash: fileHash,
  sizeBytes: 4,
  lastModifiedAt: "2026-08-04T00:00:00.000Z",
});
const sourceFile = (
  snapshotFile: LocalGameSnapshotFile,
  absolutePath: string
): LocalGameSnapshotSourceFile => ({
  ...snapshotFile,
  ruleId: "rule",
  absolutePath,
  localBindings: {
    environmentId: "environment",
    rootId: "root",
    concreteUserSegment: "default",
    concretePath: absolutePath,
  },
  confidence: "exact",
  provenance: [],
});

const context = (
  files: LocalGameSnapshotFile[],
  absolutePaths: string[]
): LocalGameSnapshotContext => ({
  gameId: { shop: "steam", objectId: "504230" },
  manifestKey: "504230",
  ruleSourceRevision: "revision",
  discoveryEngineVersion: 3,
  coverage: [],
  variants: [{ variantId, kind: "default" }],
  fileCount: files.length,
  totalSizeBytes: files.reduce((total, item) => total + item.sizeBytes, 0),
  files,
  aggregateHash: hash("f"),
  sourceFiles: files.map((item, index) =>
    sourceFile(item, absolutePaths[index])
  ),
  environmentId: "environment",
  pathContext: {
    shop: "steam",
    objectId: "504230",
    platform: "windows",
    homeDir: "C:\\Users\\Hydra",
    storeUserContext: { known: [] },
  },
  customPathRawPaths: [],
});

const anchor = (files: LocalGameSnapshotFile[]): CloudSaveSyncAnchor => ({
  schemaVersion: 4,
  environmentId: "environment",
  baseSnapshotId: "deleted-snapshot",
  baseVersion: 6,
  baseAggregateHash: hash("e"),
  entries: files,
  unresolvedRemoteEntryIds: [],
  updatedAt: "2026-08-04T00:00:00.000Z",
});

describe("remote snapshot deletion", () => {
  it("deletes unchanged automatic saves and conflicts on changed or new saves", () => {
    const unchanged = file("unchanged.sav", hash("1"));
    const modified = file("modified.sav", hash("2"));
    const added = file("added.sav", hash("3"));
    const plan = buildRemoteSnapshotDeletionPlan(
      context(
        [unchanged, modified, added],
        [
          "C:\\Users\\Hydra\\AppData\\Roaming\\Game\\unchanged.sav",
          "C:\\Users\\Hydra\\AppData\\Roaming\\Game\\modified.sav",
          "C:\\Users\\Hydra\\AppData\\Roaming\\Game\\added.sav",
        ]
      ),
      anchor([unchanged, { ...modified, hash: hash("4") }]),
      { ready: [], unresolved: [] }
    );

    assert.deepEqual(plan.unchangedAutomaticEntryIds, [
      cloudSaveFileKey(unchanged),
    ]);
    assert.deepEqual(plan.conflictingAutomaticEntryIds, [
      cloudSaveFileKey(added),
      cloudSaveFileKey(modified),
    ]);
    assert.deepEqual(decideRemoteSnapshotDeletion(plan), {
      kind: "conflict",
    });
    assert.deepEqual(decideRemoteSnapshotDeletion(plan, "keep-remote"), {
      kind: "accept",
      deleteLocalEntryIds: plan.automaticEntryIds,
    });
    assert.deepEqual(decideRemoteSnapshotDeletion(plan, "keep-local"), {
      kind: "upload",
      uploadEntryIds: plan.automaticEntryIds,
    });
  });

  it("preserves custom identities and automatic identities inside custom roots", () => {
    const customRawPath = "<custom><windows><absolute>C:/Saves/Celeste";
    const custom = file("custom.sav", hash("1"), customRawPath);
    const overlappingAutomatic = file("overlap.sav", hash("2"));
    const automatic = file("automatic.sav", hash("3"));
    const bindings: CloudSaveCustomPathBindings = {
      ready: [
        {
          rawPath: customRawPath,
          path: "C:\\Saves\\Celeste",
          platform: "windows",
        },
      ],
      unresolved: [],
    };
    const plan = buildRemoteSnapshotDeletionPlan(
      context(
        [custom, overlappingAutomatic, automatic],
        [
          "C:\\Saves\\Celeste\\custom.sav",
          "C:\\Saves\\Celeste\\overlap.sav",
          "C:\\Users\\Hydra\\AppData\\Roaming\\Game\\automatic.sav",
        ]
      ),
      anchor([custom, overlappingAutomatic, automatic]),
      bindings
    );

    assert.deepEqual(plan.automaticEntryIds, [cloudSaveFileKey(automatic)]);
    assert.deepEqual(decideRemoteSnapshotDeletion(plan), {
      kind: "accept",
      deleteLocalEntryIds: [cloudSaveFileKey(automatic)],
    });
  });

  it("does not accept a stale conflict resolution", () => {
    const unchanged = file("unchanged.sav", hash("1"));
    const plan = buildRemoteSnapshotDeletionPlan(
      context(
        [unchanged],
        ["C:\\Users\\Hydra\\AppData\\Roaming\\Game\\unchanged.sav"]
      ),
      anchor([unchanged]),
      { ready: [], unresolved: [] }
    );

    assert.throws(
      () => decideRemoteSnapshotDeletion(plan, "keep-local"),
      /cloud_save_conflict_no_longer_exists/
    );
  });

  it("accepts a remote deletion with no automatic files without proposing an empty upload", () => {
    const customRawPath = "<custom><windows><absolute>C:/Saves/Celeste";
    const custom = file("custom.sav", hash("1"), customRawPath);
    const plan = buildRemoteSnapshotDeletionPlan(
      context([custom], ["C:\\Saves\\Celeste\\custom.sav"]),
      anchor([custom]),
      {
        ready: [
          {
            rawPath: customRawPath,
            path: "C:\\Saves\\Celeste",
            platform: "windows",
          },
        ],
        unresolved: [],
      }
    );

    assert.deepEqual(decideRemoteSnapshotDeletion(plan), {
      kind: "accept",
      deleteLocalEntryIds: [],
    });
  });
});
