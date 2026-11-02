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
  resolveRestoreDownloadSources,
  selectRestoreFiles,
} from "./restore-replacements.ts";
import { cloudSaveFileKey } from "./cloud-save-contract.js";

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
  it("keeps exact selection and download identities for existing restore flows", () => {
    for (const rawPath of [
      "<home>/Game",
      "<emulator>/rpcs3/NPUB31848/00000001",
      "<emulator>/retroarch-v2/snes",
      "<custom>/folder",
    ]) {
      const entry = {
        ...target(
          "1".repeat(64),
          "C:/Game/save.dat",
          "2026-07-20T10:00:00.000Z",
          "replace"
        ),
        rawPath,
      };
      const files = [entry];
      assert.equal(selectRestoreFiles(files), files);
      assert.deepEqual(selectRestoreFiles([entry], []), []);
      assert.deepEqual(
        selectRestoreFiles(
          [entry],
          [cloudSaveFileKey(entry), cloudSaveFileKey(entry)]
        ),
        [entry]
      );
      assert.throws(
        () => selectRestoreFiles([entry], ["missing"]),
        /Requested restore file is missing from manifest/
      );
      assert.equal(resolveRestoreDownloadSources([entry])[0], entry);
      assert.equal(
        buildRestoreReplacements(
          [entry],
          [{ ...entry, tempPath: "C:/Temp/save.blob" }]
        )[0].action,
        "restore"
      );
    }
  });

  it("rejects missing mapped sources or downloaded files even when content matches", () => {
    const entry = target(
      "1".repeat(64),
      "C:/Game/save.dat",
      "2026-07-20T10:00:00.000Z",
      "replace"
    );
    assert.throws(
      () => resolveRestoreDownloadSources([entry], new Map()),
      /Missing restore download source file/
    );
    const source = { ...entry, rawPath: "<emulator>/retroarch/snes/1234ABCD" };
    const mapping = new Map([[cloudSaveFileKey(entry), source]]);
    assert.throws(
      () =>
        buildRestoreReplacements(
          [entry],
          [{ ...entry, tempPath: "C:/Temp/save.blob" }],
          mapping
        ),
      /Missing downloaded restore file/
    );
  });

  it("rejects mapped source and downloaded metadata mismatches", () => {
    const entry = target(
      "1".repeat(64),
      "C:/Game/save.dat",
      "2026-07-20T10:00:00.000Z",
      "replace"
    );
    const source = { ...entry, rawPath: "<emulator>/retroarch/snes/1234ABCD" };
    const mapping = new Map([[cloudSaveFileKey(entry), source]]);
    for (const change of [
      { hash: "b".repeat(64) },
      { sizeBytes: 5 },
      { lastModifiedAt: "2026-07-21T10:00:00.000Z" },
    ]) {
      assert.throws(
        () =>
          resolveRestoreDownloadSources(
            [entry],
            new Map([[cloudSaveFileKey(entry), { ...source, ...change }]])
          ),
        /Restore download source file does not match resolved target/
      );
      assert.throws(
        () =>
          buildRestoreReplacements(
            [entry],
            [{ ...source, ...change, tempPath: "C:/Temp/save.blob" }],
            mapping
          ),
        /Downloaded restore file does not match resolved target/
      );
    }
  });

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

    assert.deepEqual(buildRestoreReplacements([skipped], [], new Map()), [
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

  it("requires complete file accounting but allows metadata-only failures", () => {
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

    assert.equal(isRestoreReplacementSuccessful(result, 1), false);
    assert.equal(
      isRestoreReplacementSuccessful(
        {
          ...result,
          restoredFiles: [
            {
              variantId: "variant",
              rawPath: "<home>/game",
              relativePath: "slot.sav",
              targetPath: "C:/Game/slot.sav",
              restoreRootPath: "C:/Game",
              lastModifiedAt: "2026-07-20T00:00:00.000Z",
            },
          ],
        },
        1
      ),
      true
    );
  });
});
