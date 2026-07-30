import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RestoreManifestFile } from "../../../types/index.ts";

import { buildCloudSaveCustomPathRebindApproval } from "./custom-path-rebind-approval.ts";

const rawPath = "<custom><windows><absolute>C:/Saves";
const otherRawPath = "<custom><windows><absolute>C:/Other";

const remoteFile = (
  path: string,
  relativePath: string,
  sizeBytes: number
): RestoreManifestFile => ({
  variantId: "a".repeat(64),
  rawPath: path,
  relativePath,
  hash: "b".repeat(64),
  sizeBytes,
  lastModifiedAt: "2026-07-30T00:45:00.000Z",
});

describe("Cloud Save custom path rebind approval", () => {
  it("preselects the current path and includes only matching remote files", () => {
    const approval = buildCloudSaveCustomPathRebindApproval({
      gameId: { shop: "steam", objectId: "game" },
      rawPath,
      suggestedPath: "C:/Current",
      selectedPath: "C:/Current",
      canUseSuggestedPath: false,
      remoteFiles: [
        remoteFile(rawPath, "slot-two.sav", 20),
        remoteFile(otherRawPath, "other.sav", 100),
        remoteFile(rawPath, "slot-one.sav", 10),
      ],
      snapshot: { id: "snapshot", version: 2 },
    });

    assert.equal(approval.purpose, "custom-path-rebind");
    assert.equal(approval.rawPath, rawPath);
    assert.equal(approval.selectedPath, "C:/Current");
    assert.equal(approval.fileCount, 2);
    assert.equal(approval.totalSizeBytes, 30);
    assert.deepEqual(
      approval.files.map((file) => file.relativePath),
      ["slot-one.sav", "slot-two.sav"]
    );
    assert.equal(approval.snapshotId, "snapshot");
    assert.equal(approval.snapshotVersion, 2);
  });

  it("supports changing a registered path before any remote snapshot exists", () => {
    const approval = buildCloudSaveCustomPathRebindApproval({
      gameId: { shop: "steam", objectId: "game" },
      rawPath,
      suggestedPath: "C:/Current",
      selectedPath: "C:/Current",
      canUseSuggestedPath: false,
      remoteFiles: [],
      snapshot: null,
    });

    assert.equal(approval.fileCount, 0);
    assert.equal(approval.totalSizeBytes, 0);
    assert.deepEqual(approval.files, []);
    assert.equal(approval.snapshotId, null);
    assert.equal(approval.snapshotVersion, null);
  });
});
