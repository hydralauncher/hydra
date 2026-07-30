import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LocalGameSnapshotSourceFile, PrepareSnapshotFile } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  groupUploadsByHash,
  validatePrepareResponse,
} from "./upload-local-game-snapshot-helpers.ts";

const variantId = "1".repeat(64);
const source = (
  relativePath: string,
  hash: string
): LocalGameSnapshotSourceFile => ({
  variantId,
  ruleId: "local-rule",
  rawPath: "<home>/game",
  relativePath,
  absolutePath: `C:/saves/${relativePath}`,
  hash,
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
  localBindings: {
    environmentId: "environment",
    rootId: "root",
    concreteUserSegment: "__unbound__",
    concretePath: `C:/saves/${relativePath}`,
  },
  confidence: "authoritative",
  provenance: ["test"],
});

const upload = (relativePath: string): PrepareSnapshotFile => ({
  variantId,
  rawPath: "<home>/game",
  relativePath,
  status: "upload",
  uploadUrl: `https://upload.invalid/${relativePath}`,
  requiredHeaders: {
    "Content-Length": "4",
    "x-amz-checksum-sha256": `${"A".repeat(43)}=`,
  },
});

describe("prepare snapshot response", () => {
  it("validates the current composite response contract", () => {
    const response = validatePrepareResponse({
      pendingSnapshotId: "pending1",
      snapshotHash: "a".repeat(64),
      files: [
        {
          variantId,
          rawPath: "<home>/game",
          relativePath: "first.sav",
          status: "skip",
        },
        upload("second.sav"),
      ],
    });

    assert.equal(response.files.length, 2);
  });

  it("rejects missing required upload headers and duplicate identities", () => {
    assert.throws(() =>
      validatePrepareResponse({
        pendingSnapshotId: "pending1",
        snapshotHash: "a".repeat(64),
        files: [
          {
            variantId,
            rawPath: "<home>/game",
            relativePath: "first.sav",
            status: "upload",
            uploadUrl: "https://upload.invalid/first",
            requiredHeaders: { "Content-Length": "4" },
          },
        ],
      })
    );
    assert.throws(() =>
      validatePrepareResponse({
        pendingSnapshotId: "pending1",
        snapshotHash: "a".repeat(64),
        files: [upload("same.sav"), upload("same.sav")],
      })
    );
  });
});

describe("upload blob grouping", () => {
  it("deduplicates equal SHA-256 blobs across composite entries", () => {
    const hash = "b".repeat(64);
    const groups = groupUploadsByHash([
      { file: upload("first.sav"), source: source("first.sav", hash) },
      { file: upload("second.sav"), source: source("second.sav", hash) },
    ]);

    assert.equal(groups.size, 1);
    assert.equal([...groups.values()][0].length, 2);
  });

  it("does not deduplicate the same hash with a divergent size", () => {
    const first = source("first.sav", "b".repeat(64));
    const second = { ...source("second.sav", "b".repeat(64)), sizeBytes: 5 };
    const groups = groupUploadsByHash([
      { file: upload("first.sav"), source: first },
      { file: upload("second.sav"), source: second },
    ]);

    assert.equal(groups.size, 2);
  });
});
