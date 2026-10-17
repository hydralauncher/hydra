import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  CloudSaveSyncAnchor,
  Game,
  RestoreManifestResponse,
  SnapshotFile,
} from "@types";

import {
  assertRetroArchRestoreSelectionUnchanged,
  migrateRetroArchAnchor,
  migrateRetroArchManifest,
} from "./retroarch-snapshot-migration.js";
import {
  cloudSaveFileKey,
  validateRestoreDownloadUrls,
} from "./cloud-save-contract.js";
import {
  buildRestoreReplacements,
  resolveRestoreDownloadSources,
  selectRestoreFiles,
} from "./restore-replacements.js";

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
  it("restores converted IDs using the original cloud download identities", () => {
    const original = manifest([
      file(rawA, "battery.srm", "a"),
      file(rawA, "state.state1", "b"),
      file(rawA, "state.state1.png", "c"),
    ]);
    const migration = migrateRetroArchManifest(game, original);
    const requestedIds = migration.manifest.files.map(cloudSaveFileKey);
    assert.throws(
      () => selectRestoreFiles(original.files, requestedIds),
      /Requested restore file is missing from manifest/
    );
    const selected = selectRestoreFiles(migration.manifest.files, requestedIds);
    const actions = selected.map((entry) => ({
      ...entry,
      targetPath: `/restore/${entry.relativePath}`,
      restoreRootPath: "/restore",
      action: "replace" as const,
    }));
    const sources = resolveRestoreDownloadSources(
      actions,
      migration.sourceFilesByEntryId
    );
    assert.deepEqual(sources, original.files);
    const sourceIds = new Set(sources.map(cloudSaveFileKey));
    const downloadUrls = validateRestoreDownloadUrls(
      original.files.map((entry) => ({
        ...entry,
        downloadUrl: `https://example.com/${entry.hash}`,
      }))
    );
    const downloads = downloadUrls
      .filter((entry) => sourceIds.has(cloudSaveFileKey(entry)))
      .map((entry) => ({ ...entry, tempPath: `/temp/${entry.hash}` }));
    assert.equal(downloads.length, actions.length);
    assert.throws(
      () => buildRestoreReplacements(actions, downloads),
      /Missing downloaded restore file/
    );
    const replacements = buildRestoreReplacements(
      actions,
      downloads,
      migration.sourceFilesByEntryId
    );
    assert.deepEqual(replacements.map(cloudSaveFileKey), requestedIds);
    assert.deepEqual(
      replacements.map((entry) => entry.lastModifiedAt),
      selected.map((entry) => entry.lastModifiedAt)
    );
    assert.ok(replacements.every((entry) => entry.action === "restore"));
    const state = selected.find((entry) =>
      entry.relativePath.endsWith(".state")
    );
    const image = selected.find((entry) => entry.relativePath.endsWith(".png"));
    assert.ok(state && image);
    assert.equal(
      image.relativePath,
      state.relativePath.replace(/\.state$/, ".png")
    );
  });

  it("keeps the deduplicated representative's exact source and metadata", () => {
    const firstState = {
      ...file(rawB, "state.state2", "a"),
      lastModifiedAt: "2026-09-29T00:00:00.000Z",
      stateMetadata: { emulatorId: "retroarch", coreId: "Snes9x" },
    };
    const firstImage = file(rawB, "state.state2.png", "b");
    const original = manifest([
      firstState,
      firstImage,
      file(rawA, "state.state1", "a"),
      file(rawA, "state.state1.png", "c"),
    ]);
    const migration = migrateRetroArchManifest(game, original);
    assert.equal(migration.manifest.files.length, 2);
    const sources = resolveRestoreDownloadSources(
      migration.manifest.files,
      migration.sourceFilesByEntryId
    );
    assert.equal(sources[0], firstState);
    assert.equal(sources[1], firstImage);
    assert.equal(
      migration.manifest.files[0].lastModifiedAt,
      firstState.lastModifiedAt
    );
    assert.deepEqual(
      migration.manifest.files[0].stateMetadata,
      firstState.stateMetadata
    );
  });

  it("uses the selected battery source and preserves the other source as archive", () => {
    const original = manifest([
      file(rawA, "battery.srm", "a"),
      file(rawB, "battery.srm", "b"),
    ]);
    const migration = migrateRetroArchManifest(game, original, rawB);
    const active = migration.manifest.files.find(
      (entry) => entry.relativePath === "battery.srm"
    );
    const archived = migration.manifest.files.find((entry) =>
      entry.relativePath.startsWith("archive/")
    );
    assert.ok(active && archived);
    assert.equal(
      migration.sourceFilesByEntryId.get(cloudSaveFileKey(active)),
      original.files[1]
    );
    assert.equal(
      migration.sourceFilesByEntryId.get(cloudSaveFileKey(archived)),
      original.files[0]
    );
    const requested = selectRestoreFiles(migration.manifest.files, [
      cloudSaveFileKey(active),
    ]);
    assert.deepEqual(
      resolveRestoreDownloadSources(requested, migration.sourceFilesByEntryId),
      [original.files[1]]
    );
  });

  it("rejects changed or removed battery choices before applying restore", () => {
    const original = manifest([
      file(rawA, "battery.srm", "a"),
      file(rawB, "battery.srm", "b"),
    ]);
    const selected = migrateRetroArchManifest(game, original, rawA);
    assert.doesNotThrow(() =>
      assertRetroArchRestoreSelectionUnchanged(
        selected,
        migrateRetroArchManifest(game, original, rawA)
      )
    );
    for (const choice of [rawB, undefined]) {
      assert.throws(
        () =>
          assertRetroArchRestoreSelectionUnchanged(
            selected,
            migrateRetroArchManifest(game, original, choice)
          ),
        /cloud_save_restore_destination_changed/
      );
    }
  });

  it("preserves V2 and unrelated identities without migration or a battery choice", () => {
    const original = manifest([
      file("<emulator>/retroarch-v2/snes", "battery.srm", "a"),
      file("<emulator>/rpcs3/NPUB31848/00000001", "slot/PARAM.SFO", "b"),
      file("<custom>/folder", "save.dat", "c"),
      file("<home>/Game", "save.dat", "d"),
    ]);
    const migration = migrateRetroArchManifest(game, original);
    assert.equal(migration.changed, false);
    assert.deepEqual(migration.manifest.files, original.files);
    assert.deepEqual(
      resolveRestoreDownloadSources(
        migration.manifest.files,
        migration.sourceFilesByEntryId
      ),
      original.files
    );
    assert.doesNotThrow(() =>
      assertRetroArchRestoreSelectionUnchanged(
        migration,
        migrateRetroArchManifest(game, original, rawA)
      )
    );
  });

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
      unresolvedRemoteEntryIds: [cloudSaveFileKey(oldFiles[1])],
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
    assert.equal(migrated?.baseVersion, anchor.baseVersion);
    assert.equal(migrated?.baseAggregateHash, anchor.baseAggregateHash);
    assert.equal(migrated?.environmentId, "new-environment");
    assert.deepEqual(migrated?.unresolvedRemoteEntryIds, [
      cloudSaveFileKey(migration.manifest.files[0]),
    ]);
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
