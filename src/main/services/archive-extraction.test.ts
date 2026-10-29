import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExtractionProgress } from "./7zip";
import {
  ARCHIVE_PASSWORDS,
  type ArchiveExtractors,
  extractArchive,
} from "./archive-extraction.ts";
import type { InPlaceExtractionResult } from "./native-addon";

const request = {
  filePath: "/downloads/Game/game.part1.rar",
  outputPath: "/downloads/Game",
  inPlace: true,
};

function extractors(inPlace: InPlaceExtractionResult, enabled = true) {
  const calls = {
    inPlace: [] as Parameters<ArchiveExtractors["inPlace"]>[0][],
    sevenZip: [] as Parameters<ArchiveExtractors["sevenZip"]>[0][],
    log: [] as string[],
  };
  const ports: ArchiveExtractors = {
    inPlaceEnabled: async () => enabled,
    inPlace: async (options, onProgress) => {
      calls.inPlace.push(options);
      onProgress(0.25);
      return inPlace;
    },
    sevenZip: async (options) => {
      calls.sevenZip.push(options);
      return { success: true };
    },
    log: (message) => calls.log.push(message),
  };
  return { calls, ports };
}

test("a finished in-place extraction skips 7-Zip", async () => {
  const { calls, ports } = extractors({ status: "finished" });
  const progress: ExtractionProgress[] = [];

  const result = await extractArchive(ports, request, (p) => progress.push(p));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls.inPlace, [
    {
      archivePath: request.filePath,
      outputPath: request.outputPath,
      passwords: ARCHIVE_PASSWORDS,
      allowFresh: true,
    },
  ]);
  assert.equal(calls.sevenZip.length, 0);
  assert.deepEqual(progress, [{ percent: 25, fileCount: 0, file: "" }]);
});

test("an archive hatchzip leaves untouched goes to 7-Zip", async () => {
  const { calls, ports } = extractors({
    status: "unavailable",
    message: "solid RAR archives can't be extracted in place",
  });

  const result = await extractArchive(ports, request, () => {});

  assert.deepEqual(result, { success: true });
  assert.deepEqual(calls.sevenZip, [
    {
      filePath: request.filePath,
      outputPath: request.outputPath,
      passwords: ARCHIVE_PASSWORDS,
    },
  ]);
  assert.equal(calls.log.length, 1);
});

test("a partly consumed archive is never handed to 7-Zip", async () => {
  const { calls, ports } = extractors({
    status: "failed",
    message: "disk full",
  });

  await assert.rejects(
    extractArchive(ports, request, () => {}),
    /stopped: disk full/
  );
  assert.equal(calls.sevenZip.length, 0);
});

test("a kept archive is still offered to hatchzip so a started one resumes", async () => {
  const { calls, ports } = extractors({
    status: "unavailable",
    message: "in-place extraction was not requested",
  });

  await extractArchive(ports, { ...request, inPlace: false }, () => {});

  assert.equal(calls.inPlace[0].allowFresh, false);
  assert.equal(calls.sevenZip.length, 1);
  assert.equal(calls.log.length, 0);
});

test("with the feature flag off, every archive goes straight to 7-Zip", async () => {
  const { calls, ports } = extractors({ status: "finished" }, false);

  const result = await extractArchive(ports, request, () => {});

  assert.deepEqual(result, { success: true });
  assert.equal(calls.inPlace.length, 0);
  assert.deepEqual(calls.sevenZip, [
    {
      filePath: request.filePath,
      outputPath: request.outputPath,
      passwords: ARCHIVE_PASSWORDS,
    },
  ]);
});
