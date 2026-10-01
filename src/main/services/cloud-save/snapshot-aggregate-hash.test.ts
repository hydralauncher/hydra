import assert from "node:assert/strict";
import { it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import { foldStateMetadataIntoHash } from "./state-metadata-hash.ts";

const variant = { variantId: "a".repeat(64), kind: "default" as const };
const file = {
  variantId: variant.variantId,
  rawPath: "<emulator>/retroarch/snes/1234ABCD",
  relativePath: "state.state",
  hash: "b".repeat(64),
  sizeBytes: 10,
  lastModifiedAt: "2026-01-01T00:00:00.000Z",
};

it("changes the aggregate hash when state metadata changes, preserving old hashes", () => {
  const base = foldStateMetadataIntoHash("c".repeat(64), [file]);
  const oldWithTimestampChange = foldStateMetadataIntoHash("c".repeat(64), [
    { ...file, lastModifiedAt: "2026-02-01T00:00:00.000Z" },
  ]);
  const withMetadata = foldStateMetadataIntoHash("c".repeat(64), [
    { ...file, stateMetadata: { emulatorId: "retroarch", coreId: "snes9x" } },
  ]);
  assert.equal(base, oldWithTimestampChange);
  assert.notEqual(base, withMetadata);
  assert.equal(
    withMetadata,
    foldStateMetadataIntoHash("c".repeat(64), [
      { ...file, stateMetadata: { emulatorId: "retroarch", coreId: "snes9x" } },
    ])
  );
});
