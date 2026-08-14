import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveCustomPathBindings,
  LocalGameSnapshotSourceFile,
} from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { getDeletableGameCloudSaveSourceFiles } from "./delete-game-cloud-save-targets.ts";

const customRawPath = "<custom><windows><base>/CustomSaves";
const bindings: CloudSaveCustomPathBindings = {
  ready: [
    {
      rawPath: customRawPath,
      path: "C:\\Games\\Example\\CustomSaves",
      platform: "windows",
    },
  ],
  unresolved: [
    {
      rawPath: "<custom><windows>C:/Games/Example/LegacySaves",
      pathHint: "C:\\Games\\Example\\LegacySaves",
      state: "needs-confirmation",
      reason: "legacy",
      registered: true,
    },
  ],
};

const sourceFile = (
  rawPath: string,
  absolutePath: string
): LocalGameSnapshotSourceFile => ({
  variantId: "a".repeat(64),
  rawPath,
  relativePath: "slot.sav",
  ruleId: "rule",
  absolutePath,
  hash: "b".repeat(64),
  sizeBytes: 1,
  lastModifiedAt: "2026-08-04T00:00:00.000Z",
  localBindings: {
    environmentId: "windows",
    rootId: "root",
    concreteUserSegment: "default",
    concretePath: absolutePath,
  },
  confidence: "exact",
  provenance: [],
});

describe("delete all game cloud save targets", () => {
  it("preserves custom identities and every file physically inside a custom path", () => {
    const customIdentity = sourceFile(
      customRawPath,
      "C:\\Games\\Example\\CustomSaves\\slot.sav"
    );
    const overlappingAutomaticIdentity = sourceFile(
      "<base>/CustomSaves/other.sav",
      "C:\\Games\\Example\\CustomSaves\\other.sav"
    );
    const automaticSave = sourceFile(
      "<winAppData>/Example/slot.sav",
      "C:\\Users\\Hydra\\AppData\\Roaming\\Example\\slot.sav"
    );
    const similarlyNamedSibling = sourceFile(
      "<base>/CustomSaves-old/slot.sav",
      "C:\\Games\\Example\\CustomSaves-old\\slot.sav"
    );
    const unresolvedCustomSave = sourceFile(
      "<base>/LegacySaves/slot.sav",
      "C:\\Games\\Example\\LegacySaves\\slot.sav"
    );

    assert.deepEqual(
      getDeletableGameCloudSaveSourceFiles(
        [
          customIdentity,
          overlappingAutomaticIdentity,
          unresolvedCustomSave,
          automaticSave,
          similarlyNamedSibling,
        ],
        bindings,
        "windows"
      ),
      [automaticSave, similarlyNamedSibling]
    );
  });
});
