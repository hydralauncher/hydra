import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveState,
  LocalGameSnapshotFile,
  LocalGameSnapshotSourceFile,
  RemoteSnapshotSummary,
  RestoreManifestFile,
} from "@types";

import {
  buildCloudSaveV2FileDetails,
  loadCloudSaveV2FileDetails,
} from "./cloud-save-v2-file-details.ts";

const locator = (rawPath: string) => ({
  version: 1 as const,
  ruleId: `rule:${rawPath}`,
  rawRule: rawPath,
  ruleSource: "test",
  rootKind: "home",
  targetSemantics: "directory-tree" as const,
  bindings: {
    store: "steam",
    storeGameId: "game",
    storeUser: {
      kind: "opaque-folder" as const,
      store: "steam",
      concreteFolderId: "profile",
    },
  },
});

const logicalId = (rawPath: string, relativePath: string) =>
  JSON.stringify([rawPath, relativePath]);

const localFile = (
  rawPath: string,
  relativePath: string,
  hash: string,
  sizeBytes = 4
): LocalGameSnapshotFile => ({
  logicalFileId: logicalId(rawPath, relativePath),
  variantId: `variant:${rawPath}`,
  ruleId: `rule:${rawPath}`,
  relativePath,
  locator: locator(rawPath),
  contentHash: hash,
  sizeBytes,
});

const sourceFile = (
  file: LocalGameSnapshotFile,
  absolutePath = `C:\\Saves\\${file.relativePath.replaceAll("/", "\\")}`
): LocalGameSnapshotSourceFile => ({
  logicalFileId: file.logicalFileId,
  variantId: file.variantId,
  ruleId: file.ruleId,
  relativePath: file.relativePath,
  absolutePath,
  contentHash: file.contentHash,
  sizeBytes: file.sizeBytes,
  lastModifiedAt: "2026-07-21T10:00:00.000Z",
  localBindings: {
    environmentId: "environment",
    rootId: "root",
    concreteUserSegment: "profile",
    concretePath: absolutePath,
  },
  confidence: "inferred",
  provenance: [file.ruleId],
});

const remoteFile = (
  rawPath: string,
  relativePath: string,
  hash: string,
  sizeBytes = 4,
  lastModifiedAt?: string
): RestoreManifestFile => ({
  logicalFileId: logicalId(rawPath, relativePath),
  variantId: `variant:${rawPath}`,
  ruleId: `rule:${rawPath}`,
  relativePath,
  locator: locator(rawPath),
  contentHash: hash,
  sizeBytes,
  lastModifiedAt,
});

const snapshot = (
  fileCount: number,
  totalSizeBytes: number
): RemoteSnapshotSummary => ({
  id: "active-snapshot",
  status: "active",
  createdAt: "2026-07-21T11:00:00.000Z",
  fileCount,
  totalSizeBytes,
  aggregateHash: "snapshot-hash",
  revision: 1,
  schemaVersion: 2,
});

const buildDetails = (
  state: CloudSaveState,
  localFiles: LocalGameSnapshotFile[],
  activeSnapshot: RemoteSnapshotSummary | null,
  remoteFiles: RestoreManifestFile[],
  conflictLogicalFileIds: string[] = []
) =>
  buildCloudSaveV2FileDetails({
    state,
    localFiles,
    localSourceFiles: localFiles.map((file) => sourceFile(file)),
    localTotalSizeBytes: localFiles.reduce(
      (total, file) => total + file.sizeBytes,
      0
    ),
    activeSnapshot,
    remoteFiles,
    conflictLogicalFileIds,
  });

describe("cloud save V2 file details", () => {
  it("pairs files using logicalFileId without exposing hashes", () => {
    const localFiles = [
      localFile("<home>/game-a", "slot.dat", "same"),
      localFile("<home>/game-b", "slot.dat", "local-version"),
      localFile("<home>/game-a", "local.dat", "local-only"),
    ];
    const remoteFiles = [
      remoteFile("<home>/game-a", "slot.dat", "same"),
      remoteFile("<home>/game-b", "slot.dat", "remote-version"),
      remoteFile("<home>/game-a", "remote.dat", "remote-only"),
    ];

    const details = buildDetails(
      "conflict",
      localFiles,
      snapshot(3, 12),
      remoteFiles,
      [logicalId("<home>/game-b", "slot.dat")]
    );

    assert.deepEqual(
      details.comparisons.map(({ rawPath, relativePath, status }) => [
        rawPath,
        relativePath,
        status,
      ]),
      [
        ["<home>/game-a", "local.dat", "local-only"],
        ["<home>/game-a", "remote.dat", "remote-only"],
        ["<home>/game-a", "slot.dat", "unchanged"],
        ["<home>/game-b", "slot.dat", "modified"],
      ]
    );
    assert.equal(
      details.comparisons[0].local?.absolutePath,
      "C:\\Saves\\local.dat"
    );
    assert.equal("hash" in details.comparisons[0].local!, false);
    assert.equal("hash" in details.comparisons[1].remote!, false);
    assert.deepEqual(
      details.variants.map(({ variantId, fileCount, conflictCount }) => ({
        variantId,
        fileCount,
        conflictCount,
      })),
      [
        {
          variantId: "variant:<home>/game-a",
          fileCount: 3,
          conflictCount: 0,
        },
        {
          variantId: "variant:<home>/game-b",
          fileCount: 1,
          conflictCount: 1,
        },
      ]
    );
  });

  it("returns only the local source outside conflicts", () => {
    const file = localFile("<home>/game", "slot.dat", "same");
    const details = buildDetails("synced", [file], null, []);

    assert.equal(details.local.files[0].absolutePath, "C:\\Saves\\slot.dat");
    assert.equal(details.activeSnapshot, null);
    assert.deepEqual(details.comparisons, []);
  });

  it("preserves optional remote modification dates during conflicts", () => {
    const lastModifiedAt = "2026-07-20T09:30:00.000Z";
    const details = buildDetails("conflict", [], snapshot(2, 8), [
      remoteFile("<home>/game", "dated.dat", "remote", 4, lastModifiedAt),
      remoteFile("<home>/game", "undated.dat", "remote"),
    ]);

    assert.equal(
      details.activeSnapshot?.files[0].lastModifiedAt,
      lastModifiedAt
    );
    assert.equal(details.activeSnapshot?.files[1].lastModifiedAt, null);
  });

  it("rejects mismatched local sources and inconsistent remote manifests", () => {
    const file = localFile("<home>/game", "slot.dat", "same");

    assert.throws(() =>
      buildCloudSaveV2FileDetails({
        state: "local-ahead",
        localFiles: [file],
        localSourceFiles: [],
        localTotalSizeBytes: 4,
        activeSnapshot: null,
        remoteFiles: [],
      })
    );
    assert.throws(() => buildDetails("conflict", [], snapshot(2, 8), []));
    assert.throws(() => buildDetails("conflict", [], null, []));
  });
});

describe("loadCloudSaveV2FileDetails", () => {
  const createInput = (
    state: CloudSaveState,
    activeSnapshot: RemoteSnapshotSummary | null
  ) => {
    const file = localFile("<home>/game", "slot.dat", "local");
    return {
      objectId: "game",
      shop: "steam" as const,
      state,
      localFiles: [file],
      localSourceFiles: [sourceFile(file)],
      localTotalSizeBytes: 4,
      activeSnapshot,
    };
  };

  it("does not request a remote manifest outside conflicts", async () => {
    let manifestRequests = 0;
    const details = await loadCloudSaveV2FileDetails(
      createInput("synced", snapshot(1, 4)),
      async () => {
        manifestRequests += 1;
        throw new Error("Manifest should not be requested");
      }
    );

    assert.equal(manifestRequests, 0);
    assert.equal(details.activeSnapshot, null);
  });

  it("requests and validates only the active snapshot during conflicts", async () => {
    const activeSnapshot = snapshot(1, 4);
    const requestedSnapshots: string[] = [];
    const details = await loadCloudSaveV2FileDetails(
      createInput("conflict", activeSnapshot),
      async (snapshotId) => {
        requestedSnapshots.push(snapshotId);
        return {
          snapshot: {
            id: snapshotId,
            objectId: "game",
            shop: "steam",
            revision: 1,
            aggregateHash: "snapshot-hash",
            schemaVersion: 2,
          },
          files: [remoteFile("<home>/game", "slot.dat", "remote")],
        };
      }
    );

    assert.deepEqual(requestedSnapshots, ["active-snapshot"]);
    assert.equal(details.comparisons[0].status, "modified");
  });
});
