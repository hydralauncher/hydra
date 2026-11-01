import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ArchiveExtractors,
  extractArchive,
  shouldExtractArchiveInPlace,
} from "./archive-extraction.js";

const createExtractors = (
  overrides: Partial<ArchiveExtractors> = {}
): {
  extractors: ArchiveExtractors;
  calls: {
    inPlaceEnabled: number;
    inPlace: number;
    sevenZip: number;
  };
} => {
  const calls = {
    inPlaceEnabled: 0,
    inPlace: 0,
    sevenZip: 0,
  };

  const extractors: ArchiveExtractors = {
    inPlaceEnabled: async () => {
      calls.inPlaceEnabled += 1;
      return true;
    },
    inPlace: async () => {
      calls.inPlace += 1;
      return { status: "finished" };
    },
    hasInPlaceJournal: () => false,
    sevenZip: async () => {
      calls.sevenZip += 1;
      return { success: true };
    },
    log: () => undefined,
    ...overrides,
  };

  return { extractors, calls };
};

describe("shouldExtractArchiveInPlace", () => {
  it("defaults to true when neither download nor user preferences specify it", () => {
    assert.equal(shouldExtractArchiveInPlace(null, null), true);
    assert.equal(shouldExtractArchiveInPlace({}, {}), true);
  });

  it("uses user preference when download option is unset", () => {
    assert.equal(
      shouldExtractArchiveInPlace({}, { extractInPlaceByDefault: false }),
      false
    );
    assert.equal(
      shouldExtractArchiveInPlace({}, { extractInPlaceByDefault: true }),
      true
    );
  });

  it("lets per-download option override user preference", () => {
    assert.equal(
      shouldExtractArchiveInPlace(
        { extractInPlace: false },
        { extractInPlaceByDefault: true }
      ),
      false
    );
    assert.equal(
      shouldExtractArchiveInPlace(
        { extractInPlace: true },
        { extractInPlaceByDefault: false }
      ),
      true
    );
  });
});

describe("extractArchive", () => {
  it("uses 7-Zip when archive is kept (inPlace is false)", async () => {
    const { extractors, calls } = createExtractors();

    const result = await extractArchive(
      extractors,
      {
        filePath: "/games/archive.zip",
        outputPath: "/games/archive",
        inPlace: false,
        resume: false,
        recordInPlaceStart: async () => undefined,
        forgetInPlaceStart: async () => undefined,
      },
      () => undefined
    );

    assert.equal(result.success, true);
    assert.equal(calls.inPlaceEnabled, 0);
    assert.equal(calls.inPlace, 0);
    assert.equal(calls.sevenZip, 1);
  });

  it("uses 7-Zip when user opted out or feature flag is disabled", async () => {
    const { extractors, calls } = createExtractors({
      inPlaceEnabled: async () => false,
    });

    const result = await extractArchive(
      extractors,
      {
        filePath: "/games/archive.zip",
        outputPath: "/games/archive",
        inPlace: true,
        resume: false,
        recordInPlaceStart: async () => undefined,
        forgetInPlaceStart: async () => undefined,
      },
      () => undefined
    );

    assert.equal(result.success, true);
    assert.equal(calls.inPlace, 0);
    assert.equal(calls.sevenZip, 1);
  });

  it("extracts in place when archive is deleted and in-place extraction is enabled", async () => {
    const { extractors, calls } = createExtractors();
    let recorded = false;

    const result = await extractArchive(
      extractors,
      {
        filePath: "/games/archive.zip",
        outputPath: "/games/archive",
        inPlace: true,
        resume: false,
        recordInPlaceStart: async () => {
          recorded = true;
        },
        forgetInPlaceStart: async () => undefined,
      },
      () => undefined
    );

    assert.equal(result.success, true);
    assert.equal(recorded, true);
    assert.equal(calls.inPlace, 1);
    assert.equal(calls.sevenZip, 0);
  });

  it("resumes an already-started in-place extraction even if preference is later disabled", async () => {
    const { extractors, calls } = createExtractors({
      inPlaceEnabled: async () => false,
    });

    const result = await extractArchive(
      extractors,
      {
        filePath: "/games/archive.zip",
        outputPath: "/games/archive",
        inPlace: false,
        resume: true,
        recordInPlaceStart: async () => undefined,
        forgetInPlaceStart: async () => undefined,
      },
      () => undefined
    );

    assert.equal(result.success, true);
    assert.equal(calls.inPlace, 1);
    assert.equal(calls.sevenZip, 0);
  });
});
