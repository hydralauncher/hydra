import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveMergeResult,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { excludeCloudSaveRawPathsFromMerge } from "./custom-path-removal.ts";

const variant = (id: string): SnapshotVariant => ({
  variantId: id,
  kind: "default",
});

const file = (rawPath: string, relativePath: string): SnapshotFile => ({
  variantId: "1".repeat(64),
  rawPath,
  relativePath,
  hash: "a".repeat(64),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-28T10:00:00.000Z",
});

describe("custom path removal proposal", () => {
  it("removes only the selected rawPath and does not schedule local deletion", () => {
    const removed = file("<custom><windows><winDocuments>/Game", "slot.dat");
    const kept = file("<winAppData>/Game", "settings.dat");
    const entryId = (value: SnapshotFile) =>
      JSON.stringify([value.variantId, value.rawPath, value.relativePath]);
    const merge: CloudSaveMergeResult = {
      variants: [variant(removed.variantId)],
      files: [removed, kept],
      conflicts: [
        { entryId: entryId(removed), local: removed, remote: removed },
      ],
      restoreEntryIds: [entryId(removed)],
      deleteRemoteEntryIds: [],
      deleteLocalEntryIds: [entryId(removed)],
      unresolvedRemoteEntryIds: [entryId(removed)],
      partial: true,
    };
    const analysis = {
      localSnapshot: {
        files: [removed, kept],
        coverage: [],
      },
      remoteManifest: {
        files: [removed, kept],
      },
      anchor: {
        entries: [removed, kept],
      },
      syncDirection: "bidirectional",
    } as Parameters<typeof excludeCloudSaveRawPathsFromMerge>[0];

    const result = excludeCloudSaveRawPathsFromMerge(
      analysis,
      merge,
      new Set([removed.rawPath])
    );

    assert.deepEqual(result.files, [kept]);
    assert.deepEqual(result.conflicts, []);
    assert.deepEqual(result.restoreEntryIds, []);
    assert.deepEqual(result.deleteLocalEntryIds, []);
    assert.deepEqual(result.unresolvedRemoteEntryIds, []);
    assert.deepEqual(result.deleteRemoteEntryIds, [entryId(removed)]);
    assert.equal(result.partial, false);
  });

  it("produces an empty manifest when the selected path was the last one", () => {
    const removed = file("<custom><linux>/home/hydra/game", "slot.dat");
    const merge: CloudSaveMergeResult = {
      variants: [variant(removed.variantId)],
      files: [removed],
      conflicts: [],
      restoreEntryIds: [],
      deleteRemoteEntryIds: [],
      deleteLocalEntryIds: [],
      unresolvedRemoteEntryIds: [],
      partial: false,
    };
    const analysis = {
      localSnapshot: { files: [removed], coverage: [] },
      remoteManifest: { files: [removed] },
      anchor: { entries: [removed] },
      syncDirection: "bidirectional",
    } as Parameters<typeof excludeCloudSaveRawPathsFromMerge>[0];

    const result = excludeCloudSaveRawPathsFromMerge(
      analysis,
      merge,
      new Set([removed.rawPath])
    );

    assert.deepEqual(result.files, []);
    assert.deepEqual(result.variants, []);
  });
});
