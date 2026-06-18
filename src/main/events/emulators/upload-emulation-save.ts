import { registerEvent } from "../register-event";
import { WindowManager, emulators, logger } from "@main/services";
import {
  levelKeys,
  ps1MemoryCardSavesSublevel,
  ps2MemoryCardSavesSublevel,
} from "@main/level";
import type {
  EmulationBackupProgress,
  EmulationCloudSave,
  EmulationSavePlatform,
  MemoryCardSaveRecord,
} from "@types";

const BACKUP_PROGRESS_CHANNEL = "on-emulation-backup-progress";

const activeBackups = new Map<string, EmulationBackupProgress>();
const backupKey = (platform: EmulationSavePlatform, cardFilePath: string) =>
  `${platform}:${cardFilePath}`;

const sanitize = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, "_") || "save";

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

const uploadOne = async (
  platform: EmulationSavePlatform,
  cardFilePath: string,
  folderName: string
): Promise<EmulationCloudSave> => {
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
registerEvent("uploadEmulationSavesForCard", uploadEmulationSavesForCard);
registerEvent("getActiveEmulationBackups", getActiveEmulationBackups);
