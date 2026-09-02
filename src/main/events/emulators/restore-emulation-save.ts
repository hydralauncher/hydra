import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { shell } from "electron";

import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import { SevenZip } from "@main/services/7zip";
import type {
  EmulationSaveMetadata,
  EmulationSavePlatform,
  MemcardRestoreResult,
  MemcardRestoreTarget,
} from "@types";
import { getDownloadsPath } from "../helpers/get-downloads-path";

const isPspMetadata = (
  metadata: EmulationSaveMetadata | Record<string, unknown> | null
): metadata is Extract<
  EmulationSaveMetadata,
  { artifactFormat: "ppsspp-savedata-zip" }
> =>
  metadata?.schemaVersion === 1 &&
  metadata.artifactFormat === "ppsspp-savedata-zip" &&
  typeof metadata.discId === "string" &&
  /^[A-Za-z]{4}\d{5}$/.test(metadata.discId) &&
  typeof metadata.savedataDirectory === "string" &&
  metadata.savedataDirectory !== "." &&
  metadata.savedataDirectory !== ".." &&
  /^[^/\\]+$/.test(metadata.savedataDirectory);

const isGamecubeMetadata = (
  metadata: EmulationSaveMetadata | Record<string, unknown> | null
): metadata is Extract<
  EmulationSaveMetadata,
  { artifactFormat: "dolphin-gci" }
> =>
  metadata?.schemaVersion === 1 &&
  metadata.artifactFormat === "dolphin-gci" &&
  typeof metadata.gameId === "string" &&
  /^[A-Za-z0-9]{6}$/.test(metadata.gameId) &&
  typeof metadata.internalFileName === "string" &&
  metadata.internalFileName.length > 0 &&
  metadata.internalFileName !== "." &&
  metadata.internalFileName !== ".." &&
  /^[^/\\]+$/.test(metadata.internalFileName) &&
  (metadata.slot === "A" || metadata.slot === "B") &&
  ["USA", "JPN", "EUR", "KOR", "DEV", "unknown"].includes(
    metadata.region as string
  );

const isWiiMetadata = (
  metadata: EmulationSaveMetadata | Record<string, unknown> | null
): metadata is Extract<
  EmulationSaveMetadata,
  { artifactFormat: "dolphin-wii-data-bin" }
> =>
  metadata?.schemaVersion === 1 &&
  metadata.artifactFormat === "dolphin-wii-data-bin" &&
  typeof metadata.titleId === "string" &&
  /^[0-9a-f]{16}$/i.test(metadata.titleId) &&
  (metadata.gameId === undefined ||
    (typeof metadata.gameId === "string" &&
      /^[A-Za-z0-9]{6}$/.test(metadata.gameId)));

const gamecubeRegionDirectory = (region: string): string => {
  if (region === "JPN") return "JAP";
  return ["USA", "EUR", "KOR", "DEV"].includes(region) ? region : "USA";
};

const preferExistingDirectories = (directories: string[]): string[] => {
  const existing = directories.filter((directory) => existsSync(directory));
  return existing.length > 0 ? existing : directories.slice(0, 1);
};

const restoreTargets = async (
  platform: EmulationSavePlatform,
  metadata: EmulationSaveMetadata | Record<string, unknown> | null = null
): Promise<MemcardRestoreTarget[]> => {
  const config = await emulators.getEmulatorConfig(
    emulators.emulationSavePlatformToSystem(platform)
  );
  if (!config.executablePath) return [];

  if (platform === "ps1" || platform === "ps2") {
    const files =
      platform === "ps2"
        ? await emulators.resolvePs2MemcardFiles(config.executablePath)
        : await emulators.resolvePs1MemcardFiles(config.executablePath);
    return files.map((cardFilePath) => ({
      cardFilePath,
      cardLabel: path.basename(cardFilePath),
    }));
  }

  if (platform === "psp" && isPspMetadata(metadata)) {
    const directories = await emulators.ppssppSavedataDirectoryCandidates(
      config.executablePath
    );
    return preferExistingDirectories(directories).map((cardFilePath) => ({
      cardFilePath,
      cardLabel: "PPSSPP SAVEDATA",
    }));
  }

  if (platform === "gamecube" && isGamecubeMetadata(metadata)) {
    const region = gamecubeRegionDirectory(metadata.region);
    const directories = emulators
      .dolphinUserDirectoryCandidates(config.executablePath)
      .map((userDirectory) =>
        path.join(userDirectory, "GC", region, `Card ${metadata.slot}`)
      );
    return preferExistingDirectories(directories).map((cardFilePath) => ({
      cardFilePath,
      cardLabel: `${metadata.region} · Card ${metadata.slot}`,
    }));
  }

  if (platform === "wii" && isWiiMetadata(metadata)) {
    const cardFilePath = path.join(await getDownloadsPath(), "Hydra Wii Saves");
    return [{ cardFilePath, cardLabel: "Dolphin Wii save export" }];
  }

  return [];
};

// Local cards a downloaded save can be written into (for the restore picker).
const getMemcardRestoreTargets = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  metadata?: EmulationSaveMetadata | Record<string, unknown> | null
): Promise<MemcardRestoreTarget[]> => restoreTargets(platform, metadata);

const restorePpssppSave = async (
  bytes: Buffer,
  savedataRoot: string,
  metadata: Extract<
    EmulationSaveMetadata,
    { artifactFormat: "ppsspp-savedata-zip" }
  >
): Promise<void> => {
  await fs.mkdir(savedataRoot, { recursive: true });
  const temporaryRoot = await fs.mkdtemp(
    path.join(savedataRoot, ".hydra-restore-")
  );
  const archivePath = path.join(temporaryRoot, "save.zip");
  const extractionPath = path.join(temporaryRoot, "extracted");
  const stagedPath = path.join(temporaryRoot, "staged");
  const backupPath = path.join(
    path.dirname(savedataRoot),
    "HYDRA_BACKUPS",
    `${metadata.savedataDirectory}-${Date.now()}-${randomUUID()}`
  );
  const targetPath = path.join(savedataRoot, metadata.savedataDirectory);
  let movedExisting = false;

  try {
    await fs.writeFile(archivePath, bytes);
    const entries = await SevenZip.listFiles(archivePath);
    if (
      !emulators.archiveEntriesBelongToDirectory(
        entries,
        metadata.savedataDirectory
      )
    ) {
      throw new Error("The PPSSPP save archive has an invalid layout");
    }
    await SevenZip.extractFile({
      filePath: archivePath,
      outputPath: extractionPath,
    });

    const wrappedPath = path.join(extractionPath, metadata.savedataDirectory);
    const wrappedStat = await fs.stat(wrappedPath);
    if (!wrappedStat.isDirectory()) {
      throw new Error("The PPSSPP save archive has no savedata directory");
    }
    const sourcePath = wrappedPath;
    const discId = await emulators.readPpssppSavedataDiscId(sourcePath);
    if (discId !== metadata.discId.toUpperCase()) {
      throw new Error("The PPSSPP save does not match its metadata");
    }
    await fs.cp(sourcePath, stagedPath, { recursive: true });

    if (existsSync(targetPath)) {
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.rename(targetPath, backupPath);
      movedExisting = true;
    }
    await fs.rename(stagedPath, targetPath);
  } catch (error) {
    if (movedExisting) {
      await fs.rm(targetPath, { recursive: true, force: true }).catch(() => {});
      await fs.rename(backupPath, targetPath).catch(() => {});
    }
    throw error;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
};

const restoreGamecubeSave = async (
  bytes: Buffer,
  targetDirectory: string,
  metadata: Extract<EmulationSaveMetadata, { artifactFormat: "dolphin-gci" }>,
  sourceFileName?: string
): Promise<void> => {
  await fs.mkdir(targetDirectory, { recursive: true });
  const targetFileName =
    sourceFileName &&
    path.basename(sourceFileName) === sourceFileName &&
    sourceFileName.toLowerCase().endsWith(".gci")
      ? sourceFileName
      : `${metadata.gameId}-${metadata.internalFileName.replace(
          /[^A-Za-z0-9._-]/g,
          "_"
        )}.gci`;
  const targetPath = path.join(targetDirectory, targetFileName);
  const temporaryPath = path.join(
    targetDirectory,
    `.hydra-${randomUUID()}.gci`
  );
  const backupPath = `${targetPath}.hydra-backup-${Date.now()}`;
  let backedUp = false;
  try {
    await fs.writeFile(temporaryPath, bytes);
    const gameId = emulators.parseGciGameId(bytes.subarray(0, 6));
    const internalFileName = emulators.parseGciInternalFileName(
      bytes.subarray(0, 0x40)
    );
    if (
      gameId !== metadata.gameId.toUpperCase() ||
      internalFileName !== metadata.internalFileName
    ) {
      throw new Error("The GameCube save does not match its metadata");
    }
    try {
      await fs.copyFile(targetPath, backupPath);
      backedUp = true;
      await fs.unlink(targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    if (backedUp) await fs.copyFile(backupPath, targetPath).catch(() => {});
    if (backedUp) await fs.rm(backupPath, { force: true }).catch(() => {});
    throw error;
  }
};

const restoreWiiSaveExport = async (
  bytes: Buffer,
  targetDirectory: string,
  metadata: Extract<
    EmulationSaveMetadata,
    { artifactFormat: "dolphin-wii-data-bin" }
  >
): Promise<string> => {
  const gameCode = Buffer.from(metadata.titleId.slice(8), "hex").toString(
    "ascii"
  );
  if (!/^[A-Za-z0-9]{4}$/.test(gameCode)) {
    throw new Error("Invalid Wii save title ID");
  }

  await fs.mkdir(targetDirectory, { recursive: true });
  const exportRoot = await fs.mkdtemp(
    path.join(targetDirectory, `${metadata.titleId}-`)
  );
  const outputPath = path.join(
    exportRoot,
    "private",
    "wii",
    "title",
    gameCode,
    "data.bin"
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, bytes, { flag: "wx" });
  shell.showItemInFolder(outputPath);
  return outputPath;
};

// Download the cloud save and write it back into the chosen local card.
const restoreEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  saveId: string,
  targetCardFilePath: string,
  metadata: EmulationSaveMetadata | Record<string, unknown> | null = null,
  sourceFileName?: string
): Promise<MemcardRestoreResult> => {
  try {
    const allowedTargets = await restoreTargets(platform, metadata);
    if (
      (platform === "psp" || platform === "gamecube" || platform === "wii") &&
      !allowedTargets.some(
        (target) => target.cardFilePath === targetCardFilePath
      )
    ) {
      throw new Error("Invalid emulator save restore destination");
    }

    const bytes = await emulators.downloadEmulationSaveBytes(saveId);
    if (platform === "psp") {
      if (!isPspMetadata(metadata)) {
        throw new Error("Invalid PPSSPP save metadata");
      }
      await restorePpssppSave(bytes, targetCardFilePath, metadata);
      return { ok: true };
    }
    if (platform === "gamecube") {
      if (!isGamecubeMetadata(metadata)) {
        throw new Error("Invalid GameCube save metadata");
      }
      await restoreGamecubeSave(
        bytes,
        targetCardFilePath,
        metadata,
        sourceFileName
      );
      return { ok: true };
    }
    if (platform === "wii") {
      if (!isWiiMetadata(metadata)) {
        throw new Error("Invalid Wii save metadata");
      }
      const location = await restoreWiiSaveExport(
        bytes,
        targetCardFilePath,
        metadata
      );
      return { ok: true, reason: "manual-import-required", location };
    }

    const result =
      platform === "ps2"
        ? await emulators.importPsuIntoCard(targetCardFilePath, bytes)
        : await emulators.importMcsIntoCard(targetCardFilePath, bytes);
    if (!result.ok) {
      logger.error(
        "Failed to restore emulation save",
        { platform, saveId, targetCardFilePath, reason: result.reason },
        result.error
      );
    }
    return { ok: result.ok, error: result.error, reason: result.reason };
  } catch (err) {
    logger.error("Failed to restore emulation save", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

registerEvent("getMemcardRestoreTargets", getMemcardRestoreTargets);
registerEvent("restoreEmulationSave", restoreEmulationSave);
