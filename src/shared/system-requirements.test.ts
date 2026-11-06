import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findRequirementMismatches,
  parseRequirementSizes,
  requirementHtmlToLines,
} from "./system-requirements.js";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const steamMinimum = `<ul>
  <li><strong>OS:</strong> Windows 10 64-bit</li>
  <li><strong>Processor:</strong> Intel Core i5-6600K</li>
  <li><strong>Memory:</strong> 8 GB RAM</li>
  <li><strong>Graphics:</strong> NVIDIA GTX 970 (4 GB VRAM)</li>
  <li><strong>Storage:</strong> 50 GB available space</li>
</ul>`;

describe("requirementHtmlToLines", () => {
  it("returns one plain-text line per list item and decodes entities", () => {
    assert.deepEqual(
      requirementHtmlToLines(
        "<li><b>Memory:</b>&nbsp;8&nbsp;GB &amp; more</li><br>x"
      ),
      ["Memory: 8 GB & more", "x"]
    );
  });
});

describe("parseRequirementSizes", () => {
  it("reads system RAM and storage from Steam-style HTML", () => {
    assert.deepEqual(parseRequirementSizes(steamMinimum), {
      memoryBytes: 8 * GB,
      storageBytes: 50 * GB,
    });
  });

  it("ignores video memory rows", () => {
    const parsed = parseRequirementSizes(
      "<li>Graphics: 2 GB Video Memory</li><li>Memory: 4 GB RAM</li>"
    );
    assert.equal(parsed.memoryBytes, 4 * GB);
  });

  it("supports MB values and decimal commas", () => {
    assert.deepEqual(
      parseRequirementSizes("<li>RAM: 512 MB</li><li>Hard Drive: 1,5 GB</li>"),
      { memoryBytes: 512 * MB, storageBytes: 1.5 * GB }
    );
  });

  it("returns null for values that are not listed", () => {
    assert.deepEqual(parseRequirementSizes("<li>OS: Windows 10</li>"), {
      memoryBytes: null,
      storageBytes: null,
    });
    assert.deepEqual(parseRequirementSizes(""), {
      memoryBytes: null,
      storageBytes: null,
    });
  });
});

describe("findRequirementMismatches", () => {
  const requirements = { memoryBytes: 8 * GB, storageBytes: 50 * GB };

  it("reports nothing when the PC meets the requirements", () => {
    assert.deepEqual(
      findRequirementMismatches(requirements, {
        totalMemoryBytes: 16 * GB,
        freeStorageBytes: 200 * GB,
      }),
      []
    );
  });

  it("reports low memory and low free storage", () => {
    assert.deepEqual(
      findRequirementMismatches(requirements, {
        totalMemoryBytes: 4 * GB,
        freeStorageBytes: 10 * GB,
      }),
      [
        { kind: "memory", requiredBytes: 8 * GB, availableBytes: 4 * GB },
        { kind: "storage", requiredBytes: 50 * GB, availableBytes: 10 * GB },
      ]
    );
  });

  it("allows for RAM that reports slightly below the advertised size", () => {
    // 8 GB advertised is reported as about 7.7 GiB by the OS.
    assert.deepEqual(
      findRequirementMismatches(requirements, {
        totalMemoryBytes: 7.7 * GB,
        freeStorageBytes: null,
      }),
      []
    );
  });

  it("skips checks that have no requirement or no measurement", () => {
    assert.deepEqual(
      findRequirementMismatches(
        { memoryBytes: null, storageBytes: null },
        { totalMemoryBytes: 1 * GB, freeStorageBytes: 1 * GB }
      ),
      []
    );
    assert.deepEqual(
      findRequirementMismatches(requirements, {
        totalMemoryBytes: 16 * GB,
        freeStorageBytes: null,
      }),
      []
    );
  });
});
