import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import type { EmulatorDiscoveredFile } from "./emulator-provider-types";
import { emulatorProviderSourcePaths } from "./emulator-provider-source-path.js";

const file = (rawPath: string): EmulatorDiscoveredFile => ({
  variantId: "variant",
  ruleId: "rule",
  rawPath,
  absolutePath: path.join("/tmp", "canonical.gci"),
  relativePath: "own.gci",
  localBindings: {
    environmentId: "environment",
    rootId: "root",
    concreteUserSegment: "__default__",
    concretePath: path.join("/saves", "Card A"),
  },
  confidence: "exact",
  provenance: [],
});

describe("emulator provider source paths", () => {
  it("deduplicates Dolphin GCI source files against canonical exports", () => {
    assert.deepEqual(
      emulatorProviderSourcePaths(file("<emulator>/dolphin-gci/A/GM8E01")),
      [
        path.join("/tmp", "canonical.gci"),
        path.join("/saves", "Card A", "own.gci"),
      ]
    );
  });

  it("leaves unrelated provider paths unchanged", () => {
    assert.deepEqual(
      emulatorProviderSourcePaths(file("<emulator>/pcsx2-state/SLUS-00000")),
      [path.join("/tmp", "canonical.gci")]
    );
  });
});
