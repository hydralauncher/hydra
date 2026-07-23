import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LocalGameSnapshotSourceFile, PrepareSnapshotFile } from "@types";

import {
  groupUploadsByHash,
  validatePrepareResponse,
} from "./upload-local-game-snapshot-helpers.ts";

const source = (
  logicalFileId: string,
  contentHash: string,
  sizeBytes: number
): LocalGameSnapshotSourceFile => ({
  logicalFileId,
  variantId: "variant",
  ruleId: "rule",
  relativePath: `${logicalFileId}.sav`,
  absolutePath: `C:/saves/${logicalFileId}.sav`,
  contentHash,
  sizeBytes,
  lastModifiedAt: "2026-01-01T00:00:00.000000000Z",
  localBindings: {
    environmentId: "environment",
    rootId: "root",
    concreteUserSegment: "12345",
    concretePath: "C:/saves/12345",
  },
  confidence: "authoritative",
  provenance: ["test:rule"],
});

const upload = (logicalFileId: string): PrepareSnapshotFile => ({
  logicalFileId,
  status: "upload",
  uploadUrl: `https://upload.invalid/${logicalFileId}`,
});

describe("cloud save snapshot preparation", () => {
  it("deduplicates transfers only by content hash and size", () => {
    const sameHash = "a".repeat(64);
    const groups = groupUploadsByHash([
      { file: upload("first"), source: source("first", sameHash, 4) },
      { file: upload("second"), source: source("second", sameHash, 4) },
      { file: upload("third"), source: source("third", sameHash, 5) },
      {
        file: upload("fourth"),
        source: source("fourth", "b".repeat(64), 4),
      },
    ]);

    assert.equal(groups.size, 3);
    assert.deepEqual(
      [...groups.values()].map((items) => items.length).sort(),
      [1, 1, 2]
    );
  });

  it("requires revision echo and one response per logical file", () => {
    const response = validatePrepareResponse({
      pendingSnapshotId: "pending",
      snapshotHash: "hash",
      expectedHeadRevision: 7,
      files: [
        { logicalFileId: "first", status: "skip" },
        {
          logicalFileId: "second",
          status: "upload",
          uploadUrl: "https://upload.invalid/second",
        },
      ],
    });

    assert.equal(response.expectedHeadRevision, 7);
    assert.throws(() =>
      validatePrepareResponse({
        ...response,
        files: [response.files[0], response.files[0]],
      })
    );
  });
});
