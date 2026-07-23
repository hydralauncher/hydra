import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  DownloadedRestoreFile,
  ReplaceRestoreTargetsResult,
  ResolvedRestoreTarget,
} from "../../../types/index.ts";

import {
  buildRestoreReplacements,
  isRestoreReplacementSuccessful,
} from "./restore-replacements.ts";

const hash = "a".repeat(64);
const target = (
  variantId: string,
  targetPath: string,
  lastModifiedAt: string,
  action: ResolvedRestoreTarget["action"]
): ResolvedRestoreTarget => ({
  variantId,
  rawPath: "<home>/Game",
  relativePath: "save.dat",
  hash,
  sizeBytes: 4,
  lastModifiedAt,
  targetPath,
  restoreRootPath: "C:/Game",
  action,
});

describe("restore replacements", () => {
  it("preserves identity timestamps when two targets reuse one downloaded blob", () => {
    const first = target(
      "1".repeat(64),
      "C:/Game/one/save.dat",
      "2026-07-20T10:00:00.000Z",
      "replace"
    );
    const second = target(
      "2".repeat(64),
      "C:/Game/two/save.dat",
      "2026-07-22T10:00:00.000Z",
      "create"
    );
    const downloads: DownloadedRestoreFile[] = [first, second].map((file) => ({
      variantId: file.variantId,
      rawPath: file.rawPath,
      relativePath: file.relativePath,
      hash: file.hash,
      sizeBytes: file.sizeBytes,
      lastModifiedAt: file.lastModifiedAt,
      tempPath: "C:/Temp/shared.blob",
    }));

    const replacements = buildRestoreReplacements([first, second], downloads);

    assert.equal(replacements[0].action, "restore");
    assert.equal(replacements[1].action, "restore");
    assert.equal(replacements[0].lastModifiedAt, first.lastModifiedAt);
    assert.equal(replacements[1].lastModifiedAt, second.lastModifiedAt);
    assert.equal(
      replacements[0].action === "restore" && replacements[0].tempPath,
      "C:/Temp/shared.blob"
    );
    assert.equal(
      replacements[1].action === "restore" && replacements[1].tempPath,
      "C:/Temp/shared.blob"
    );
  });

  it("passes timestamp, root and expected hash to skip-identical", () => {
    const skipped = target(
      "1".repeat(64),
      "C:/Game/save.dat",
      "2026-07-20T10:00:00.000Z",
      "skip-identical"
    );

    assert.deepEqual(buildRestoreReplacements([skipped], []), [
      {
        variantId: skipped.variantId,
        rawPath: skipped.rawPath,
        relativePath: skipped.relativePath,
        targetPath: skipped.targetPath,
        restoreRootPath: skipped.restoreRootPath,
        lastModifiedAt: skipped.lastModifiedAt,
        action: "skip",
        expectedHash: hash,
      },
    ]);
  });

  it("does not accept metadata failures as a successful restore", () => {
    const result: ReplaceRestoreTargetsResult = {
      restoredFiles: [],
      skippedFiles: [],
      failedFiles: [],
      metadataFailures: [
        {
          path: "C:/Game",
          kind: "directory",
          reason: "failed-to-set-mtime",
        },
      ],
      updatedDirectoryCount: 0,
    };

    assert.equal(isRestoreReplacementSuccessful(result), false);
    assert.equal(
      isRestoreReplacementSuccessful({
        ...result,
        metadataFailures: [],
      }),
      true
    );
  });
});
