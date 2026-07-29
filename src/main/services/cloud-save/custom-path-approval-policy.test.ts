import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { RestoreManifestFile } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { getUnboundCloudSaveCustomPathRestoreCandidates } from "./custom-path-approval-policy.ts";

const file = (rawPath: string, relativePath: string): RestoreManifestFile => ({
  variantId: "default",
  rawPath,
  relativePath,
  hash: `${rawPath}:${relativePath}`,
  sizeBytes: 10,
  lastModifiedAt: "2026-07-29T00:00:00.000Z",
});

describe("cloud save custom path approval policy", () => {
  it("returns only unbound custom paths included in the restore plan", () => {
    const first = file("<custom><windows><winDocuments>/Game", "slot-1.sav");
    const second = file("<custom><windows><winDocuments>/Game", "slot-2.sav");
    const bound = file("<custom><windows><winAppData>/OtherGame", "save.dat");
    const notRestored = file(
      "<custom><windows><winLocalAppData>/ThirdGame",
      "save.dat"
    );
    const regular = file("<winDocuments>/Game", "settings.ini");

    const result = getUnboundCloudSaveCustomPathRestoreCandidates(
      [first, second, bound, notRestored, regular],
      [first, second, bound, regular].map(cloudSaveFileKey),
      [bound.rawPath]
    );

    assert.deepEqual(result, [
      {
        rawPath: first.rawPath,
        files: [first, second],
      },
    ]);
  });

  it("sorts multiple pending destinations to make sequential prompts stable", () => {
    const second = file("<custom><windows><winDocuments>/Zeta", "save.dat");
    const first = file("<custom><windows><winDocuments>/Alpha", "save.dat");

    const result = getUnboundCloudSaveCustomPathRestoreCandidates(
      [second, first],
      [cloudSaveFileKey(second), cloudSaveFileKey(first)],
      []
    );

    assert.deepEqual(
      result.map(({ rawPath }) => rawPath),
      [first.rawPath, second.rawPath]
    );
  });
});
