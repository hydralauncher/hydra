import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { registerEvent } from "../register-event";
import { WindowManager, emulators, logger } from "@main/services";
import { SevenZip } from "@main/services/7zip";
import {
  levelKeys,
  gamesShopCacheSublevel,
  ps1MemoryCardSavesSublevel,
  ps2MemoryCardSavesSublevel,
} from "@main/level";
import type {
  EmulationBackupProgress,
  EmulationCloudSave,
  EmulationSavePlatform,
  EmulationSaveMetadata,
  MemoryCardSaveRecord,
} from "@types";
import type { DiscoveredEmulationFileSave } from "@main/services/emulators/emulation-file-saves";
import { buildLocalLaunchboxAssetIndex } from "./memcard-local-assets";

const BACKUP_PROGRESS_CHANNEL = "on-emulation-backup-progress";
const MIN_WII_DATA_BIN_SIZE = 0xf140;

const activeBackups = new Map<string, EmulationBackupProgress>();
const backupKey = (platform: EmulationSavePlatform, cardFilePath: string) =>
  `${platform}:${cardFilePath}`;

const sanitize = (name: string): string =>
  (name.replace(/[^A-Za-z0-9._-]/g, "_") || "save").slice(0, 240);

const getRecord = (
  platform: EmulationSavePlatform,
  cardFilePath: string,
  folderName: string
): Promise<MemoryCardSaveRecord | undefined> => {
  if (platform === "ps2") {
    return ps2MemoryCardSavesSublevel
      .get(levelKeys.ps2MemoryCardSave(cardFilePath, folderName))
      .catch(() => undefined);
  }
  return ps1MemoryCardSavesSublevel
    .get(levelKeys.ps1MemoryCardSave(cardFilePath, folderName))
    .catch(() => undefined);
};

const getFileSaveRecord = async (
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube">,
  sourcePath: string,
  saveIdentity: string
) => {
  const config = await emulators.getEmulatorConfig(
    emulators.emulationSavePlatformToSystem(platform)
  );
  if (!config.executablePath) return null;
  const saves = await emulators.discoverEmulationFileSaves(
    platform,
    config.executablePath
  );
  return (
    saves.find(
      (save) =>
        save.sourcePath === sourcePath && save.saveIdentity === saveIdentity
    ) ?? null
  );
};

// Build the exportable artifact bytes (.psu for PS2, .mcs for PS1).
const buildArtifact = async (
  platform: EmulationSavePlatform,
  cardFilePath: string,
  folderName: string
): Promise<{ buffer: Buffer; ext: "psu" | "mcs" } | null> => {
  if (platform === "ps2") {
    const contents = await emulators.readSaveContents(cardFilePath, folderName);
    if (!contents) return null;
    return { buffer: emulators.buildPsuBuffer(contents), ext: "psu" };
  }
  const contents = await emulators.readPs1SaveContents(
    cardFilePath,
    folderName
  );
  if (!contents) return null;
  return { buffer: emulators.buildMcsBuffer(contents), ext: "mcs" };
};

const buildFileSaveArtifact = async (
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube">,
  discovered: DiscoveredEmulationFileSave
): Promise<{ buffer: Buffer; fileName: string }> => {
  if (platform === "gamecube") {
    return {
      buffer: await fs.readFile(discovered.sourcePath),
      fileName: path.basename(discovered.sourcePath),
    };
  }

  if (discovered.metadata.artifactFormat !== "ppsspp-savedata-zip") {
    throw new Error("Invalid PPSSPP save metadata");
  }

  const temporaryDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-ppsspp-save-")
  );
  try {
    const fileName = `${sanitize(discovered.metadata.savedataDirectory)}.zip`;
    const archivePath = path.join(temporaryDirectory, fileName);
    const stagingPath = path.join(temporaryDirectory, "staging");
    await fs.mkdir(stagingPath);
    await fs.cp(
      discovered.sourcePath,
      path.join(stagingPath, discovered.metadata.savedataDirectory),
      { recursive: true }
    );
    await SevenZip.createZip({
      sourcePath: stagingPath,
      destinationPath: archivePath,
    });
    return { buffer: await fs.readFile(archivePath), fileName };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const uploadFileSave = async (
  platform: Extract<EmulationSavePlatform, "psp" | "gamecube">,
  sourcePath: string,
  saveIdentity: string
): Promise<EmulationCloudSave> => {
  const discovered = await getFileSaveRecord(
    platform,
    sourcePath,
    saveIdentity
  );
  if (!discovered) throw new Error(`Could not find save "${saveIdentity}"`);

  const localAssets = await buildLocalLaunchboxAssetIndex();
  const normalizedSku = emulators.normalizeSku(discovered.sku);
  const remoteAssets = localAssets.has(normalizedSku)
    ? null
    : await emulators.fetchShopDetailsForSkus([discovered.sku]);
  const remoteEntry = remoteAssets?.get(normalizedSku);
  let assets = localAssets.get(normalizedSku);
  if (!assets && remoteEntry) {
    assets = emulators.mapEntryToAssets(remoteEntry);
  }
  if (!assets) {
    throw new Error(`Could not map save "${saveIdentity}" to a catalogue game`);
  }

  const config = await emulators.getEmulatorConfig(
    emulators.emulationSavePlatformToSystem(platform)
  );
  const artifact = await buildFileSaveArtifact(platform, discovered);
  return emulators.uploadEmulationSave({
    platform,
    emulator: emulators.toEmulationSaveEmulator(config.binary),
    shop: "launchbox",
    objectId: assets.objectId,
    saveIdentity: discovered.saveIdentity,
    fileName: artifact.fileName,
    label: assets.title || discovered.saveIdentity,
    localLastModifiedAt: new Date(discovered.modifiedAt).toISOString(),
    buffer: artifact.buffer,
    metadata: discovered.metadata as EmulationSaveMetadata,
  });
};

const uploadOne = async (
  platform: EmulationSavePlatform,
  cardFilePath: string,
  folderName: string
): Promise<EmulationCloudSave> => {
  if (platform === "wii") {
    throw new Error("Wii cloud saves require a native Dolphin data.bin export");
  }

  if (platform === "psp" || platform === "gamecube") {
    return uploadFileSave(platform, cardFilePath, folderName);
  }

  const config = await emulators.getEmulatorConfig(platform);
  const record = await getRecord(platform, cardFilePath, folderName);
  const artifact = await buildArtifact(platform, cardFilePath, folderName);
  if (!artifact) throw new Error(`Could not read save "${folderName}"`);

  const title = record?.title ?? folderName;
  const lastModified = record?.modifiedAt || record?.detectedAt || 0;

  return emulators.uploadEmulationSave({
    platform,
    emulator: emulators.toEmulationSaveEmulator(config.binary),
    shop: record?.objectId ? "launchbox" : null,
    objectId: record?.objectId ?? null,
    saveIdentity: folderName,
    fileName: `${sanitize(title)}.${artifact.ext}`,
    label: title,
    localLastModifiedAt: new Date(lastModified || Date.now()).toISOString(),
    buffer: artifact.buffer,
  });
};

const uploadEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  cardFilePath: string,
  folderName: string
): Promise<EmulationCloudSave> => {
  return uploadOne(platform, cardFilePath, folderName);
};

const uploadWiiEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  dataBinPath: string,
  objectId: string
): Promise<EmulationCloudSave> => {
  const identity = emulators.parseDolphinWiiExportPath(dataBinPath);
  if (!identity) {
    throw new Error(
      "Select Dolphin's private/wii/title/<game>/data.bin export"
    );
  }
  const stat = await fs.stat(dataBinPath);
  if (!stat.isFile() || stat.size < MIN_WII_DATA_BIN_SIZE) {
    throw new Error("The selected Wii data.bin is empty or unreadable");
  }

  const cachedEntries = await gamesShopCacheSublevel.iterator().all();
  const details = cachedEntries.find(
    ([key, value]) =>
      key.startsWith("launchbox:") && value.objectId === objectId
  )?.[1];
  const normalizedSkus = (details?.skus ?? []).map((sku) =>
    emulators.normalizeSku(sku)
  );
  const gameId = normalizedSkus.find(
    (sku) => sku.length === 6 && sku.startsWith(identity.gameCode)
  );
  if (normalizedSkus.some((sku) => sku.length === 6) && !gameId) {
    throw new Error("The selected Wii save belongs to a different game");
  }

  const config = await emulators.getEmulatorConfig("dolphin");
  const metadata: EmulationSaveMetadata = {
    schemaVersion: 1,
    artifactFormat: "dolphin-wii-data-bin",
    titleId: identity.titleId,
    ...(gameId ? { gameId } : {}),
  };
  return emulators.uploadEmulationSave({
    platform: "wii",
    emulator: emulators.toEmulationSaveEmulator(config.binary),
    shop: "launchbox",
    objectId,
    saveIdentity: identity.titleId,
    fileName: `${identity.titleId}.bin`,
    label: gameId ?? identity.gameCode,
    localLastModifiedAt: new Date(stat.mtimeMs).toISOString(),
    buffer: await fs.readFile(dataBinPath),
    metadata,
  });
};

// "Back up all": upload every detected save on one card. Reports counts; per-save
// failures are logged and skipped so one bad save doesn't abort the rest.
const uploadEmulationSavesForCard = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  cardFilePath: string
): Promise<{ uploaded: number; total: number }> => {
  const sublevel =
    platform === "ps2"
      ? ps2MemoryCardSavesSublevel
      : ps1MemoryCardSavesSublevel;
  const records = (await sublevel.values().all()).filter(
    (r) => r.cardFilePath === cardFilePath
  );

  const total = records.length;
  let uploaded = 0;
  let failed = 0;

  const key = backupKey(platform, cardFilePath);
  const emit = (currentLabel: string | null) => {
    const payload = {
      platform,
      cardFilePath,
      processed: uploaded + failed,
      uploaded,
      failed,
      total,
      currentLabel,
    } satisfies EmulationBackupProgress;

    if (payload.processed >= total) activeBackups.delete(key);
    else activeBackups.set(key, payload);

    WindowManager.sendToAppWindows(BACKUP_PROGRESS_CHANNEL, payload);
  };

  for (const record of records) {
    emit(record.title ?? record.folderName);
    try {
      await uploadOne(platform, cardFilePath, record.folderName);
      uploaded += 1;
    } catch (err) {
      failed += 1;
      logger.error("Failed to back up emulation save", {
        folderName: record.folderName,
        err,
      });
    }
  }
  emit(null);

  return { uploaded, total };
};

const getActiveEmulationBackups = async (): Promise<
  EmulationBackupProgress[]
> => Array.from(activeBackups.values());

registerEvent("uploadEmulationSave", uploadEmulationSave);
registerEvent("uploadWiiEmulationSave", uploadWiiEmulationSave);
registerEvent("uploadEmulationSavesForCard", uploadEmulationSavesForCard);
registerEvent("getActiveEmulationBackups", getActiveEmulationBackups);
