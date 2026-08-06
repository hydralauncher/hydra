import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RestoreManifestFile } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getUnconfiguredCloudSaveCustomPathCandidates } from "./custom-path-approval-policy.ts";

const file = (rawPath: string, relativePath: string): RestoreManifestFile => ({
  variantId: "default",
  rawPath,
  relativePath,
  hash: `${rawPath}:${relativePath}`,
  sizeBytes: 10,
  lastModifiedAt: "2026-07-29T00:00:00.000Z",
});

describe("cloud save custom path approval policy", () => {
  it("returns every remote custom path without a local binding", () => {
    const first = file("<custom><windows><winDocuments>/Game", "slot-1.sav");
    const second = file("<custom><windows><winDocuments>/Game", "slot-2.sav");
    const bound = file("<custom><windows><winAppData>/OtherGame", "save.dat");
    const mixedSnapshotCustom = file(
      "<custom><windows><winLocalAppData>/ThirdGame",
      "save.dat"
    );
    const regular = file("<winDocuments>/Game", "settings.ini");

    const result = getUnconfiguredCloudSaveCustomPathCandidates(
      [first, second, bound, mixedSnapshotCustom, regular],
      [bound.rawPath]
    );

    assert.deepEqual(result, [
      {
        rawPath: first.rawPath,
        files: [first, second],
      },
      {
        rawPath: mixedSnapshotCustom.rawPath,
        files: [mixedSnapshotCustom],
      },
    ]);
  });

  it("sorts multiple pending destinations to make sequential prompts stable", () => {
    const second = file("<custom><windows><winDocuments>/Zeta", "save.dat");
    const first = file("<custom><windows><winDocuments>/Alpha", "save.dat");

    const result = getUnconfiguredCloudSaveCustomPathCandidates(
      [second, first],
      []
    );

    assert.deepEqual(
      result.map(({ rawPath }) => rawPath),
      [first.rawPath, second.rawPath]
    );
  });

  it("treats ready and unresolved bindings as already configured", () => {
    const ready = file("<custom><windows><winDocuments>/Ready", "ready.sav");
    const unresolved = file(
      "<custom><windows><winDocuments>/Unresolved",
      "unresolved.sav"
    );
    const unbound = file(
      "<custom><windows><winDocuments>/Unbound",
      "unbound.sav"
    );
    const bindings = {
      ready: [{ rawPath: ready.rawPath }],
      unresolved: [{ rawPath: unresolved.rawPath }],
    };

    const result = getUnconfiguredCloudSaveCustomPathCandidates(
      [ready, unresolved, unbound],
      [...bindings.ready, ...bindings.unresolved].map(({ rawPath }) => rawPath)
    );

    assert.deepEqual(result, [{ rawPath: unbound.rawPath, files: [unbound] }]);
  });

  it("does not create a candidate without remote files", () => {
    assert.deepEqual(getUnconfiguredCloudSaveCustomPathCandidates([], []), []);
  });
});
