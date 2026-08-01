import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveMergeResult,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  executeCloudSaveCustomPathRemoval,
  excludeCloudSaveRawPathsFromMerge,
  isCloudSaveRawPathRemovable,
} from "./custom-path-removal.ts";

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
  const syncResult = {
    trigger: "manual",
    action: "upload",
    initialState: "local-ahead",
    finalState: "synced",
    remoteHash: "a".repeat(64),
    environmentId: "test",
  } as const;

  it("persists a registered local removal before mutating remote state", async () => {
    const calls: string[] = [];

    const result = await executeCloudSaveCustomPathRemoval({
      isRegistered: true,
      unregister: async () => {
        calls.push("unregister");
      },
      sync: async () => {
        calls.push("sync");
        return syncResult;
      },
    });

    assert.deepEqual(calls, ["unregister", "sync"]);
    assert.equal(result, syncResult);
  });

  it("does not mutate remote state when local removal cannot be persisted", async () => {
    let syncCalled = false;

    await assert.rejects(
      executeCloudSaveCustomPathRemoval({
        isRegistered: true,
        unregister: async () => {
          throw new Error("leveldb unavailable");
        },
        sync: async () => {
          syncCalled = true;
          return syncResult;
        },
      }),
      /leveldb unavailable/
    );

    assert.equal(syncCalled, false);
  });

  it("keeps the local binding removed when remote mutation fails", async () => {
    let registered = true;

    await assert.rejects(
      executeCloudSaveCustomPathRemoval({
        isRegistered: true,
        unregister: async () => {
          registered = false;
        },
        sync: async () => {
          throw new Error("remote unavailable");
        },
      }),
      /remote unavailable/
    );

    assert.equal(registered, false);
  });

  it("removes a remote-only path without changing local bindings", async () => {
    let unregisterCalled = false;

    const result = await executeCloudSaveCustomPathRemoval({
      isRegistered: false,
      unregister: async () => {
        unregisterCalled = true;
      },
      sync: async () => syncResult,
    });

    assert.equal(unregisterCalled, false);
    assert.equal(result, syncResult);
  });

  it("reports a remote conflict after keeping the local binding removed", async () => {
    let registered = true;

    await assert.rejects(
      executeCloudSaveCustomPathRemoval({
        isRegistered: true,
        unregister: async () => {
          registered = false;
        },
        sync: async () => ({
          ...syncResult,
          action: "conflict",
          finalState: "conflict",
        }),
      }),
      /cloud_save_custom_path_removal_conflict/
    );

    assert.equal(registered, false);
  });

  it("allows an exact legacy rawPath from the active snapshot without local registration", () => {
    const rawPath = "<custom><windows>C:/Users/Hydra/AppData/Roaming/Game";
    const otherRawPath = "<custom><windows><winAppData>/Other";

    assert.equal(
      isCloudSaveRawPathRemovable(rawPath, new Set(), [
        { rawPath },
        { rawPath: otherRawPath },
      ]),
      true
    );
    assert.equal(
      isCloudSaveRawPathRemovable("<custom><windows>C:/Unknown", new Set(), [
        { rawPath },
      ]),
      false
    );
    assert.equal(
      isCloudSaveRawPathRemovable(otherRawPath, new Set([otherRawPath]), []),
      true
    );
  });

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
