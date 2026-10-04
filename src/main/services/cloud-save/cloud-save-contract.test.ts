import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  cloudSaveFileKey,
  validateCustomPathRawPaths,
  validateRemoteSnapshotSummary,
  validateRestoreDownloadUrls,
  validateRestoreManifest,
} from "./cloud-save-contract.ts";

const firstVariantId = "1".repeat(64);
const secondVariantId = "2".repeat(64);
const file = (variantId: string) => ({
  variantId,
  rawPath: "<winAppData>/Sekiro/<storeUserId>",
  relativePath: "S0000.sl2",
  hash: "a".repeat(64),
  sizeBytes: 4,
  lastModifiedAt: "2026-07-22T10:00:00.000Z",
});

describe("Cloud Save launcher API contract", () => {
  it("downloads Steam files and emulator states with optional metadata", () => {
    const steamFile = {
      ...file(firstVariantId),
      downloadUrl: "https://storage.example.com/steam-save",
    };
    const emulatorState = {
      ...file(secondVariantId),
      rawPath: "<emulator>/retroarch/snes/1234ABCD",
      relativePath: "state.state1",
      stateMetadata: { emulatorId: "retroarch", coreId: "snes9x" },
      downloadUrl: "https://storage.example.com/emulator-state",
    };

    assert.deepEqual(validateRestoreDownloadUrls([steamFile, emulatorState]), [
      steamFile,
      emulatorState,
    ]);
    assert.throws(() =>
      validateRestoreDownloadUrls([{ ...emulatorState, unknown: true }])
    );
    assert.throws(() =>
      validateRestoreDownloadUrls([
        {
          ...emulatorState,
          stateMetadata: { emulatorId: "retroarch", extra: true },
        },
      ])
    );
    assert.throws(() =>
      validateRestoreDownloadUrls([emulatorState, emulatorState])
    );
  });

  it("accepts optional state origin metadata and rejects unknown fields", () => {
    const base = {
      snapshot: {
        id: "snapshot",
        version: 1,
        shop: "launchbox",
        objectId: "game",
      },
      customPathRawPaths: [],
      variants: [{ variantId: firstVariantId, kind: "default" }],
    };
    const state = {
      ...file(firstVariantId),
      rawPath: "<emulator>/retroarch/snes/1234ABCD",
      relativePath: "state.state1",
      stateMetadata: { emulatorId: "retroarch", coreId: "snes9x" },
    };
    assert.deepEqual(
      validateRestoreManifest({ ...base, files: [state] }).files[0]
        .stateMetadata,
      state.stateMetadata
    );
    assert.throws(() =>
      validateRestoreManifest({
        ...base,
        files: [
          {
            ...state,
            stateMetadata: { ...state.stateMetadata, unknown: true },
          },
        ],
      })
    );
  });
  it("accepts the active snapshot summary and complete manifest DTOs", () => {
    const summary = validateRemoteSnapshotSummary({
      id: "snapshot",
      version: 3,
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z",
      fileCount: 2,
      totalSizeBytes: 8,
      aggregateHash: "b".repeat(64),
    });
    const manifest = validateRestoreManifest({
      snapshot: {
        id: "snapshot",
        version: 3,
        shop: "steam",
        objectId: "814380",
      },
      customPathRawPaths: [],
      variants: [
        {
          variantId: firstVariantId,
          kind: "steam-account",
          steamId64: "76561197960278073",
        },
        {
          variantId: secondVariantId,
          kind: "steam-account",
          steamId64: "76561198051718575",
        },
      ],
      files: [file(firstVariantId), file(secondVariantId)],
    });

    assert.equal(summary.version, 3);
    assert.equal(manifest.files.length, 2);
    assert.notEqual(
      cloudSaveFileKey(manifest.files[0]),
      cloudSaveFileKey(manifest.files[1])
    );
  });

  it("accepts an empty snapshot after the last tracked location is removed", () => {
    const summary = validateRemoteSnapshotSummary({
      id: "snapshot",
      version: 4,
      createdAt: "2026-07-20T10:00:00.000Z",
      updatedAt: "2026-07-22T10:00:00.000Z",
      fileCount: 0,
      totalSizeBytes: 0,
      aggregateHash: "c".repeat(64),
    });
    const manifest = validateRestoreManifest({
      snapshot: {
        id: "snapshot",
        version: 4,
        shop: "steam",
        objectId: "814380",
      },
      customPathRawPaths: [],
      variants: [],
      files: [],
    });

    assert.equal(summary.fileCount, 0);
    assert.deepEqual(manifest.variants, []);
    assert.deepEqual(manifest.files, []);
  });

  it("rejects a non-array custom path list with a TypeError", () => {
    assert.throws(() => validateCustomPathRawPaths(null), {
      name: "TypeError",
      message: "Invalid Cloud Save custom path list",
    });
  });

  it("rejects legacy head, revision and locator fields", () => {
    assert.throws(() =>
      validateRemoteSnapshotSummary({
        id: "snapshot",
        version: 3,
        createdAt: "2026-07-20T10:00:00.000Z",
        updatedAt: "2026-07-22T10:00:00.000Z",
        fileCount: 1,
        totalSizeBytes: 4,
        aggregateHash: "b".repeat(64),
        revision: 3,
      })
    );
    assert.throws(() =>
      validateRestoreManifest({
        snapshot: {
          id: "snapshot",
          version: 3,
          shop: "steam",
          objectId: "814380",
        },
        customPathRawPaths: [],
        variants: [{ variantId: firstVariantId, kind: "default" }],
        files: [{ ...file(firstVariantId), locator: {}, logicalFileId: "old" }],
      })
    );
  });

  it("rejects unused variants and duplicate composite entries", () => {
    const base = {
      snapshot: {
        id: "snapshot",
        version: 1,
        shop: "steam",
        objectId: "814380",
      },
      customPathRawPaths: [],
      variants: [
        { variantId: firstVariantId, kind: "default" },
        {
          variantId: secondVariantId,
          kind: "opaque-folder",
          concreteFolderId: "Goldberg",
        },
      ],
    };
    assert.throws(() =>
      validateRestoreManifest({
        ...base,
        files: [file(firstVariantId)],
      })
    );
    assert.throws(() =>
      validateRestoreManifest({
        ...base,
        files: [
          file(firstVariantId),
          file(secondVariantId),
          file(secondVariantId),
        ],
      })
    );
  });

  it("rejects Steam accounts outside the individual account range", () => {
    const manifest = (steamId64: string) => ({
      snapshot: {
        id: "snapshot",
        version: 1,
        shop: "steam",
        objectId: "814380",
      },
      customPathRawPaths: [],
      variants: [
        {
          variantId: firstVariantId,
          kind: "steam-account",
          steamId64,
        },
      ],
      files: [file(firstVariantId)],
    });

    assert.throws(() => validateRestoreManifest(manifest("76561197960265727")));
    assert.throws(() => validateRestoreManifest(manifest("76561202255233024")));
    assert.doesNotThrow(() =>
      validateRestoreManifest(manifest("76561197960265728"))
    );
    assert.doesNotThrow(() =>
      validateRestoreManifest(manifest("76561202255233023"))
    );
  });
});
