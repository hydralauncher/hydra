import path from "node:path";
import { promises as fs } from "node:fs";

import {
  levelKeys,
  ps1MemoryCardSavesSublevel,
  ps2MemoryCardSavesSublevel,
} from "@main/level";
import * as emulators from "@main/services/emulators";
import type {
  DownloadedRestoreFile,
  LocalGameSnapshotContext,
  MemoryCardSaveRecord,
  ReplaceRestoreTargetsResult,
  RestoreManifestFile,
} from "@types";

import {
  assertEmulatorCloudSaveAvailable,
  withMemoryCardLock,
} from "./emulator-cloud-save";
import {
  decodeEmulatorSaveIdentity,
  emulatorCloudSaveRawPath,
} from "./emulator-cloud-save-codec";

export interface EmulatorRestoreTarget extends RestoreManifestFile {
  saveIdentity: string;
  cardFilePath: string;
}

export const resolveEmulatorRestoreTargets = async (
  context: LocalGameSnapshotContext,
  files: RestoreManifestFile[]
): Promise<EmulatorRestoreTarget[]> => {
  const metadata = context.emulator;
  if (!metadata) throw new Error("cloud_save_emulator_context_missing");
  await assertEmulatorCloudSaveAvailable(metadata.platform);
  const expectedRawPath = emulatorCloudSaveRawPath(metadata.platform);

  return Promise.all(
    files.map(async (file) => {
      if (file.rawPath !== expectedRawPath) {
        throw new Error("cloud_save_emulator_raw_path_invalid");
      }
      const saveIdentity = decodeEmulatorSaveIdentity(
        file.relativePath,
        metadata.platform
      );
      const preferredPath = metadata.preferredCardPaths[saveIdentity];
      const localPaths = [
        ...new Set(
          metadata.copies
            .filter((copy) => copy.saveIdentity === saveIdentity)
            .map((copy) => copy.cardFilePath)
        ),
      ];
      const cardFilePath =
        preferredPath ?? (localPaths.length === 1 ? localPaths[0] : null);
      if (!cardFilePath) {
        throw new Error("cloud_save_emulator_target_required");
      }
      const format = await withMemoryCardLock(cardFilePath, () =>
        metadata.platform === "ps1"
          ? emulators.inspectPs1Card(cardFilePath)
          : emulators.inspectPs2Card(cardFilePath)
      );
      if (format !== "formatted") {
        throw new Error("cloud_save_emulator_card_invalid");
      }
      return { ...file, saveIdentity, cardFilePath };
    })
  );
};

const persistRestoredSave = async (
  context: LocalGameSnapshotContext,
  target: EmulatorRestoreTarget
) => {
  const metadata = context.emulator!;
  const game = context.gameId;
  const cardLabel = path.basename(target.cardFilePath);
  if (metadata.platform === "ps1") {
    const info = await emulators.listPs1Saves(target.cardFilePath);
    const save = info?.saves.find(
      (candidate) => candidate.identifier === target.saveIdentity
    );
    if (!save) return;
    const record: MemoryCardSaveRecord = {
      cardFilePath: target.cardFilePath,
      cardLabel,
      folderName: save.identifier,
      sku: save.sku ?? null,
      objectId: game.objectId,
      shop: "launchbox",
      title: null,
      iconUrl: null,
      libraryImageUrl: null,
      libraryHeroImageUrl: null,
      logoImageUrl: null,
      fileCount: save.blockCount,
      sizeBytes: save.sizeBytes,
      createdAt: 0,
      modifiedAt: 0,
      detectedAt: Date.now(),
    };
    await ps1MemoryCardSavesSublevel.put(
      levelKeys.ps1MemoryCardSave(target.cardFilePath, target.saveIdentity),
      record
    );
    return;
  }

  const info = await emulators.listSaves(target.cardFilePath);
  const save = info?.saves.find(
    (candidate) => candidate.folderName === target.saveIdentity
  );
  if (!save) return;
  const record: MemoryCardSaveRecord = {
    cardFilePath: target.cardFilePath,
    cardLabel,
    folderName: save.folderName,
    sku: save.sku ?? null,
    objectId: game.objectId,
    shop: "launchbox",
    title: null,
    iconUrl: null,
    libraryImageUrl: null,
    libraryHeroImageUrl: null,
    logoImageUrl: null,
    fileCount: save.fileCount,
    sizeBytes: save.sizeBytes,
    createdAt: save.createdSecs * 1000,
    modifiedAt: save.modifiedSecs * 1000,
    detectedAt: Date.now(),
  };
  await ps2MemoryCardSavesSublevel.put(
    levelKeys.ps2MemoryCardSave(target.cardFilePath, target.saveIdentity),
    record
  );
};

export const applyEmulatorRestoreFiles = async (
  context: LocalGameSnapshotContext,
  targets: EmulatorRestoreTarget[],
  downloadedFiles: DownloadedRestoreFile[]
): Promise<ReplaceRestoreTargetsResult> => {
  const downloadedByIdentity = new Map(
    downloadedFiles.map((file) => [
      JSON.stringify([file.variantId, file.rawPath, file.relativePath]),
      file,
    ])
  );
  const result: ReplaceRestoreTargetsResult = {
    restoredFiles: [],
    skippedFiles: [],
    failedFiles: [],
    metadataFailures: [],
    updatedDirectoryCount: 0,
  };

  for (const target of targets) {
    const key = JSON.stringify([
      target.variantId,
      target.rawPath,
      target.relativePath,
    ]);
    const downloaded = downloadedByIdentity.get(key);
    if (!downloaded) throw new Error("Missing downloaded emulator save");

    const restored = await withMemoryCardLock(target.cardFilePath, async () => {
      const bytes = await fs.readFile(downloaded.tempPath);
      return context.emulator!.platform === "ps1"
        ? emulators.importMcsIntoCard(target.cardFilePath, bytes)
        : emulators.importPsuIntoCard(target.cardFilePath, bytes);
    });
    const identity = {
      variantId: target.variantId,
      rawPath: target.rawPath,
      relativePath: target.relativePath,
      targetPath: target.cardFilePath,
      restoreRootPath: target.cardFilePath,
      lastModifiedAt: target.lastModifiedAt,
    };
    if (restored.ok) {
      result.restoredFiles.push(identity);
      await withMemoryCardLock(target.cardFilePath, () =>
        persistRestoredSave(context, target)
      );
    } else {
      result.failedFiles.push({
        ...identity,
        reason: "restore_rolled_back",
      });
    }
  }
  return result;
};
