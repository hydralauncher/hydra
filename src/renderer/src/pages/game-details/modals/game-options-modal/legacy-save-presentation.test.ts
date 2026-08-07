import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GameArtifact } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as presentationModule from "./legacy-save-presentation.ts";

const { sortLegacySavesByNewest } = presentationModule;

const createArtifact = (id: string, createdAt: string): GameArtifact => ({
  id,
  artifactLengthInBytes: 1,
  downloadOptionTitle: null,
  createdAt,
  updatedAt: createdAt,
  hostname: "device",
  downloadCount: 0,
  isFrozen: false,
});

describe("legacy save presentation", () => {
  it("sorts saves from newest to oldest without mutating the input", () => {
    const oldest = createArtifact("oldest", "2025-01-01T00:00:00.000Z");
    const newest = createArtifact("newest", "2026-01-01T00:00:00.000Z");
    const artifacts = [oldest, newest];

    assert.deepEqual(
      sortLegacySavesByNewest(artifacts).map((artifact) => artifact.id),
      ["newest", "oldest"]
    );
    assert.deepEqual(artifacts, [oldest, newest]);
  });
});
