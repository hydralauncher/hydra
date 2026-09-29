import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmulationCloudSave, GameArtifact } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as presentationModule from "./legacy-save-presentation.ts";

const {
  sortLegacySavesByNewest,
  archivedEmulationSaveToArtifact,
  sortLegacyArchiveEntriesByNewest,
} = presentationModule;

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

  it("presents an emulation API backup as downloadable archive entry", () => {
    const save = {
      id: "emulation-id",
      fileName: "slot.psu",
      label: "My save",
      artifactLengthInBytes: 4096,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      hostname: "desktop",
    } as EmulationCloudSave;
    assert.deepEqual(archivedEmulationSaveToArtifact(save), {
      id: "emulation-id",
      artifactLengthInBytes: 4096,
      downloadOptionTitle: "slot.psu",
      createdAt: save.createdAt,
      updatedAt: save.updatedAt,
      hostname: "desktop",
      downloadCount: 0,
      label: "My save",
      isFrozen: false,
    });
  });

  it("sorts mixed Steam-style and emulation archives by creation time", () => {
    const old = createArtifact("game-api", "2025-01-01T00:00:00.000Z");
    const recent = createArtifact("emulation-api", "2026-01-01T00:00:00.000Z");
    const input = [
      { source: "game-artifact" as const, artifact: old },
      { source: "emulation-save" as const, artifact: recent },
    ];
    assert.deepEqual(
      sortLegacyArchiveEntriesByNewest(input).map(
        (entry) => `${entry.source}:${entry.artifact.id}`
      ),
      ["emulation-save:emulation-api", "game-artifact:game-api"]
    );
    assert.equal(input[0].artifact.id, "game-api");
  });
});
