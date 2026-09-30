import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveSyncAnchor,
  Game,
  RestoreManifestResponse,
  SnapshotFile,
} from "@types";

import {
  migrateRetroArchAnchor,
  migrateRetroArchManifest,
} from "./retroarch-snapshot-migration.js";

const game = { shop: "launchbox", objectId: "131" } as Game;
const rawA = "<emulator>/retroarch/snes/11111111";
const rawB = "<emulator>/retroarch/snes/22222222";
const file = (
  rawPath: string,
  relativePath: string,
  content: string
): SnapshotFile => ({
  variantId: "f".repeat(64),
  rawPath,
  relativePath,
  hash: content.repeat(64),
  sizeBytes: 1,
  lastModifiedAt: "2026-09-30T00:00:00.000Z",
});
const manifest = (files: SnapshotFile[]) =>
  ({ files }) as unknown as RestoreManifestResponse;

describe("RetroArch legacy snapshot migration", () => {
  it("joins identical states and keeps different states from two ROMs", () => {
    const migrated = migrateRetroArchManifest(
      game,
      manifest([
        file(rawA, "state.state1", "a"),
        file(rawA, "state.state1.png", "1"),
        file(rawB, "state.state2", "a"),
        file(rawB, "state.state3", "b"),
      ])
    );
    const states = migrated.manifest.files.filter((item) =>
      item.relativePath.endsWith(".state")
    );
    assert.equal(states.length, 2);
    assert.equal(new Set(states.map((item) => item.relativePath)).size, 2);
    assert.equal(
      migrated.manifest.files.filter((item) =>
        item.relativePath.endsWith(".png")
      ).length,
      1
    );
    assert.equal(migrated.conflicts.length, 0);
  });

  it("asks for a battery choice and preserves every state", () => {
    const original = manifest([
      file(rawA, "battery.srm", "a"),
      file(rawA, "battery.rtc", "1"),
      file(rawA, "state.state1", "c"),
      file(rawB, "battery.srm", "b"),
      file(rawB, "battery.rtc", "2"),
      file(rawB, "state.state1", "d"),
    ]);
    assert.ok(migrateRetroArchManifest(game, original).conflicts.length > 0);
    const selected = migrateRetroArchManifest(game, original, rawB);
    assert.equal(selected.conflicts.length, 0);
    assert.equal(
      selected.manifest.files.filter((item) =>
        item.relativePath.endsWith(".state")
      ).length,
      2
    );
    assert.equal(
      selected.manifest.files.find(
        (item) => item.relativePath === "battery.srm"
      )?.hash,
      "b".repeat(64)
    );
    assert.equal(
      selected.manifest.files.find(
        (item) => item.relativePath === "battery.rtc"
      )?.hash,
      "2".repeat(64)
    );
    assert.deepEqual(
      selected.manifest.files
        .filter((item) => item.relativePath.startsWith("archive/battery/"))
        .map((item) => item.relativePath)
        .sort(),
      ["archive/battery/11111111.rtc", "archive/battery/11111111.srm"]
    );
  });

  it("migrates the matching sync anchor to the deduplicated state ID", () => {
    const oldFiles = [
      file(rawA, "state.state1", "a"),
      file(rawB, "state.state2", "a"),
    ];
    const migration = migrateRetroArchManifest(game, manifest(oldFiles));
    const anchor = {
      schemaVersion: 4,
      environmentId: "old-environment",
      baseSnapshotId: "snapshot-1",
      baseVersion: 1,
      baseAggregateHash: "f".repeat(64),
      entries: oldFiles,
      unresolvedRemoteEntryIds: [],
      updatedAt: "2026-09-30T00:00:00.000Z",
    } as CloudSaveSyncAnchor;
    const migrated = migrateRetroArchAnchor(
      game,
      anchor,
      "new-environment",
      undefined,
      migration.stateIdByLegacyKey
    );
    assert.equal(migrated?.baseSnapshotId, "snapshot-1");
    assert.equal(migrated?.environmentId, "new-environment");
    assert.deepEqual(
      migrated?.entries.map((entry) => entry.relativePath),
      migration.manifest.files.map((entry) => entry.relativePath)
    );
  });

  it("preserves older N64 battery formats when selecting one version", () => {
    const original = manifest([
      file("<emulator>/retroarch/n64/11111111", "battery.eep", "a"),
      file("<emulator>/retroarch/n64/22222222", "battery.eep", "b"),
    ]);
    assert.equal(migrateRetroArchManifest(game, original).conflicts.length, 1);
    const selected = migrateRetroArchManifest(
      game,
      original,
      "<emulator>/retroarch/n64/22222222"
    );
    assert.equal(selected.conflicts.length, 0);
    assert.deepEqual(
      selected.manifest.files.map((item) => item.relativePath),
      ["archive/battery/11111111.eep", "battery.eep"]
    );
  });
});
