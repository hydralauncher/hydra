import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  Game,
  LudusaviBackup,
  HydraBackupMetadata,
  BackupRelocationResult,
} from "@types";
import { logger } from "./logger";

const METADATA_FILENAME = "hydra-metadata.json";

export class BackupMetadataService {
  /**
   * Extract absolute save file paths from a Ludusavi backup/preview result.
   * The keys of `games[name].files` are the absolute paths to save files.
   */
  public static extractSavePaths(
    ludusaviResult: LudusaviBackup,
    objectId: string
  ): string[] {
    const gameData = ludusaviResult.games?.[objectId];
    if (!gameData?.files) return [];
    return Object.keys(gameData.files);
  }

  /**
   * Detect the Steam emulator type based on save file paths.
   * Looks for known emulator directory names in the paths.
   */
  public static detectEmulatorType(savePaths: string[]): string | null {
    const emulatorPatterns: { pattern: RegExp; name: string }[] = [
      { pattern: /goldberg/i, name: "Goldberg" },
      { pattern: /codex/i, name: "CODEX" },
      { pattern: /empress/i, name: "EMPRESS" },
      { pattern: /rune/i, name: "RUNE" },
      { pattern: /ali213/i, name: "ALI213" },
      { pattern: /smartsteamemu/i, name: "SmartSteamEmu" },
      { pattern: /steamless/i, name: "Steamless" },
    ];

    for (const savePath of savePaths) {
      for (const { pattern, name } of emulatorPatterns) {
        if (pattern.test(savePath)) {
          return name;
        }
      }
    }

    return null;
  }

  /**
   * Create HydraBackupMetadata from a Game object and the Ludusavi backup result.
   */
  public static createMetadata(
    game: Game,
    ludusaviResult: LudusaviBackup
  ): HydraBackupMetadata {
    const savePaths = this.extractSavePaths(ludusaviResult, game.objectId);

    return {
      version: 1,
      gameName: game.title,
      steamAppId: game.objectId,
      shop: game.shop,
      backupDate: new Date().toISOString(),
      launcher: "Hydra",
      platform: process.platform,
      hostname: os.hostname(),
      originalSavePaths: savePaths,
      winePrefixPath: game.winePrefixPath ?? null,
      emulatorType: this.detectEmulatorType(savePaths),
      gameVersion: null,
    };
  }

  /**
   * Write metadata.json to the root of the backup directory.
   * This file is placed alongside Ludusavi's backup files before
   * the directory is compressed into tar.gz.
   */
  public static writeMetadataToBackupDir(
    backupDir: string,
    metadata: HydraBackupMetadata
  ): void {
    const metadataPath = path.join(backupDir, METADATA_FILENAME);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    logger.info(
      `[BackupMetadata] Wrote metadata to ${metadataPath} (${metadata.originalSavePaths.length} save paths)`
    );
  }

  /**
   * Read metadata.json from an extracted backup directory.
   * Returns null if the file doesn't exist (backward compatibility
   * with backups created before this feature).
   */
  public static readMetadataFromExtractDir(
    extractDir: string
  ): HydraBackupMetadata | null {
    const metadataPath = path.join(extractDir, METADATA_FILENAME);

    if (!fs.existsSync(metadataPath)) {
      logger.info(
        "[BackupMetadata] No metadata.json found — legacy backup, skipping compatibility check"
      );
      return null;
    }

    try {
      const raw = fs.readFileSync(metadataPath, "utf-8");
      const metadata = JSON.parse(raw) as HydraBackupMetadata;

      if (metadata.version !== 1) {
        logger.warn(
          `[BackupMetadata] Unknown metadata version: ${metadata.version}, skipping`
        );
        return null;
      }

      return metadata;
    } catch (err) {
      logger.warn("[BackupMetadata] Failed to parse metadata.json", err);
      return null;
    }
  }

  /**
   * Compare original save paths from backup metadata with current save paths
   * and relocate files if they differ. Uses overwrite strategy (backup is authoritative).
   *
   * @param metadata - The backup metadata with original save paths
   * @param currentSavePaths - Current save paths from Ludusavi preview
   * @returns Relocation result with details of what was moved
   */
  public static async relocateSaves(
    metadata: HydraBackupMetadata,
    currentSavePaths: string[]
  ): Promise<BackupRelocationResult> {
    const result: BackupRelocationResult = {
      relocated: false,
      from: [],
      to: [],
      filesRelocated: 0,
    };

    const originalPaths = metadata.originalSavePaths;

    if (originalPaths.length === 0 || currentSavePaths.length === 0) {
      return result;
    }

    // Normalize paths for comparison
    const normalizeForCompare = (p: string) =>
      p.replace(/\\/g, "/").toLowerCase();

    const originalNormalized = new Set(originalPaths.map(normalizeForCompare));
    const currentNormalized = new Set(
      currentSavePaths.map(normalizeForCompare)
    );

    // Check if paths are the same — no relocation needed
    const allMatch = [...originalNormalized].every((p) =>
      currentNormalized.has(p)
    );
    if (allMatch) {
      logger.info("[BackupMetadata] Save paths match — no relocation needed");
      return result;
    }

    // Paths differ — attempt to relocate files
    logger.info(
      `[BackupMetadata] Save paths differ. Original: ${originalPaths.length} paths, Current: ${currentSavePaths.length} paths`
    );

    // Build a mapping from original base directories to current base directories.
    // Strategy: find the common parent of original paths and current paths,
    // then copy files maintaining relative structure.
    const originalBaseDirs = this.getUniqueBaseDirs(originalPaths);
    const currentBaseDirs = this.getUniqueBaseDirs(currentSavePaths);

    for (const originalBase of originalBaseDirs) {
      // Find files restored by Ludusavi at the original path
      const filesToRelocate = originalPaths.filter(
        (p) =>
          normalizeForCompare(p).startsWith(
            normalizeForCompare(originalBase)
          ) && fs.existsSync(p)
      );

      if (filesToRelocate.length === 0) continue;

      // Find the best matching current base directory
      const targetBase = this.findBestMatchingDir(
        originalBase,
        currentBaseDirs
      );

      if (
        !targetBase ||
        normalizeForCompare(targetBase) === normalizeForCompare(originalBase)
      ) {
        continue;
      }

      result.from.push(originalBase);
      result.to.push(targetBase);

      for (const filePath of filesToRelocate) {
        try {
          const relativePath = path.relative(originalBase, filePath);
          const destinationPath = path.join(targetBase, relativePath);

          // Ensure destination directory exists
          fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

          // Overwrite strategy: copy file to new location
          fs.copyFileSync(filePath, destinationPath);
          result.filesRelocated++;

          logger.info(
            `[BackupMetadata] Relocated: ${filePath} → ${destinationPath}`
          );
        } catch (err) {
          logger.warn(
            `[BackupMetadata] Failed to relocate file: ${filePath}`,
            err
          );
        }
      }
    }

    result.relocated = result.filesRelocated > 0;

    if (result.relocated) {
      logger.info(
        `[BackupMetadata] Relocation complete: ${result.filesRelocated} files moved`
      );
    }

    return result;
  }

  /**
   * Extract unique parent directories from a list of file paths.
   */
  private static getUniqueBaseDirs(filePaths: string[]): string[] {
    const dirs = new Set<string>();
    for (const filePath of filePaths) {
      dirs.add(path.dirname(filePath));
    }
    return [...dirs];
  }

  /**
   * Find the best matching directory from candidates, based on
   * similarity of the directory name structure (same objectId subfolder, etc.).
   */
  private static findBestMatchingDir(
    originalDir: string,
    candidates: string[]
  ): string | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const originalBasename = path.basename(originalDir).toLowerCase();

    // Prefer a candidate with the same leaf directory name (e.g., same AppID folder)
    const exactLeafMatch = candidates.find(
      (c) => path.basename(c).toLowerCase() === originalBasename
    );
    if (exactLeafMatch) return exactLeafMatch;

    // Fallback: return the first candidate
    return candidates[0];
  }
}
