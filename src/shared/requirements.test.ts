import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { JSDOM } from "jsdom";
import { parseRequirementRows } from "./requirements.js";

const originalDomParser = globalThis.DOMParser;

before(() => {
  globalThis.DOMParser = new JSDOM("").window.DOMParser;
});

after(() => {
  globalThis.DOMParser = originalDomParser;
});

describe("parseRequirementRows", () => {
  it("parses structured Epic requirements", () => {
    assert.deepEqual(
      parseRequirementRows(
        "<ul><li><strong>OS</strong><span>Windows 11</span></li><li><strong>Storage</strong><span>SSD: 90 GB</span></li></ul>"
      ),
      [
        { label: "OS", value: "Windows 11" },
        { label: "Storage", value: "SSD: 90 GB" },
      ]
    );
  });

  it("parses Resident Evil 4 Steam requirements and keeps its info row", () => {
    const html =
      '<strong>Minimum:</strong><br><ul class="bb_ul"><li>Requires a 64-bit processor and operating system<br></li><li><strong>OS:</strong> Windows 10 (64 bit)<br></li><li><strong>Processor:</strong> AMD Ryzen 3 1200 / Intel Core i5-7500<br></li><li><strong>Memory:</strong> 8 GB RAM<br></li><li><strong>Graphics:</strong> AMD Radeon RX 560 / NVIDIA GeForce GTX 1050 Ti</li></ul>';

    assert.deepEqual(parseRequirementRows(html), [
      {
        label: null,
        value: "Requires a 64-bit processor and operating system",
      },
      { label: "OS", value: "Windows 10 (64 bit)" },
      {
        label: "Processor",
        value: "AMD Ryzen 3 1200 / Intel Core i5-7500",
      },
      { label: "Memory", value: "8 GB RAM" },
      {
        label: "Graphics",
        value: "AMD Radeon RX 560 / NVIDIA GeForce GTX 1050 Ti",
      },
    ]);
  });

  it("parses Baldur's Gate 3 requirements grouped into one Steam item", () => {
    const html =
      '<strong>Recommended:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10 64-bit<br><strong>Processor:</strong> Intel i7 8700K / AMD r5 3600<br><strong>Memory:</strong> 16 GB RAM<br><strong>Storage:</strong> 150 GB available space</li></ul>';

    assert.deepEqual(parseRequirementRows(html), [
      { label: "OS", value: "Windows 10 64-bit" },
      {
        label: "Processor",
        value: "Intel i7 8700K / AMD r5 3600",
      },
      { label: "Memory", value: "16 GB RAM" },
      { label: "Storage", value: "150 GB available space" },
    ]);
  });

  it("returns no rows for Portal 2's empty recommended requirements", () => {
    assert.deepEqual(parseRequirementRows(""), []);
  });

  it("supports old cached plain-text requirements", () => {
    assert.deepEqual(
      parseRequirementRows("OS: Windows 11\n\nStorage: SSD: 90 GB"),
      [
        { label: "OS", value: "Windows 11" },
        { label: "Storage", value: "SSD: 90 GB" },
      ]
    );
  });

  it("ignores empty and malformed plain-text rows", () => {
    assert.deepEqual(parseRequirementRows("\nMissing separator\nMemory:"), []);
  });

  it("returns no rows for unknown HTML so the caller can preserve it", () => {
    assert.deepEqual(
      parseRequirementRows("<p>Unstructured requirement</p>"),
      []
    );
  });
});
