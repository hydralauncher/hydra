import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmulatorLocalSaveCopy } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { selectEmulatorSaveCopies } from "./emulator-cloud-save-selection.ts";

const copy = (
  saveIdentity: string,
  cardFilePath: string,
  hash: string
): { candidate: EmulatorLocalSaveCopy } => ({
  candidate: {
    saveIdentity,
    cardFilePath,
    cardLabel: cardFilePath,
    hash,
    sizeBytes: 128,
    fileCount: 1,
    modifiedAt: null,
  },
});

describe("emulator Cloud Save copy selection", () => {
  it("selects a single copy and deduplicates equal copies", () => {
    const single = selectEmulatorSaveCopies(
      [copy("save-a", "card-b", "same")],
      {},
      new Set(["card-b"])
    );
    assert.equal(single.selected[0].candidate.cardFilePath, "card-b");
    assert.deepEqual(single.selections, []);

    const equal = selectEmulatorSaveCopies(
      [copy("save-a", "card-b", "same"), copy("save-a", "card-a", "same")],
      {},
      new Set(["card-a", "card-b"])
    );
    assert.equal(equal.selected[0].candidate.cardFilePath, "card-a");
    assert.deepEqual(equal.selections, []);
  });

  it("requires a choice for divergent copies", () => {
    const result = selectEmulatorSaveCopies(
      [copy("save-a", "card-a", "first"), copy("save-a", "card-b", "second")],
      {},
      new Set(["card-a", "card-b"])
    );

    assert.equal(result.selected.length, 0);
    assert.equal(result.selections[0].reason, "divergent-copies");
    assert.deepEqual(
      result.selections[0].candidates.map(({ cardFilePath }) => cardFilePath),
      ["card-a", "card-b"]
    );
  });

  it("uses the remembered card without silently replacing a missing one", () => {
    const preferred = selectEmulatorSaveCopies(
      [copy("save-a", "card-a", "first"), copy("save-a", "card-b", "second")],
      { "save-a": "card-b" },
      new Set(["card-a", "card-b"])
    );
    assert.equal(preferred.selected[0].candidate.cardFilePath, "card-b");

    const missing = selectEmulatorSaveCopies(
      [copy("save-a", "card-a", "first")],
      { "save-a": "card-b" },
      new Set(["card-a"])
    );
    assert.equal(missing.selected.length, 0);
    assert.equal(missing.selections[0].reason, "preferred-card-missing");
  });

  it("keeps a readable remembered card as a restore destination", () => {
    const result = selectEmulatorSaveCopies(
      [],
      { "save-a": "empty-card" },
      new Set(["empty-card"])
    );

    assert.deepEqual(result.selected, []);
    assert.deepEqual(result.selections, []);
  });
});
