import type { RetroArchPlatform } from "@types";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RETROARCH_ARCHIVE_EXTENSIONS } from "../../../shared/retroarch-platform";
import { inspectRomArchive, isRetroArchArchive } from "./rom-archive";

import { collectFilesByExtension } from "../emulators/scan-rom-folder";
import {
  ALL_RETROARCH_ROM_EXTENSIONS,
  extensionToPlatform,
} from "./retroarch-cores";

export interface ScannedRetroArchRom {
  folderPath: string;
  primaryPath: string;
  name: string;
  sizeBytes: number;
  platform: RetroArchPlatform;
  archiveEntry?: string;
  romSizeBytes?: number;
}

export interface RetroArchFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export const scanRetroArchFolder = async (
  folder: RetroArchFolderInput
): Promise<ScannedRetroArchRom[]> => {
  const stats = await fs.stat(folder.path).catch(() => null);
  const files = stats?.isFile()
    ? [
        {
          fullPath: folder.path,
          name: path.basename(folder.path),
          sizeBytes: stats.size,
        },
      ]
    : await collectFilesByExtension(
        folder.path,
        [...ALL_RETROARCH_ROM_EXTENSIONS, ...RETROARCH_ARCHIVE_EXTENSIONS],
        folder.scanSubfolders
      );

  const roms: ScannedRetroArchRom[] = [];
  for (const file of files) {
    const archived = isRetroArchArchive(file.name)
      ? await inspectRomArchive(file.fullPath)
      : null;
    const platform = archived?.platform ?? extensionToPlatform(file.name);
    if (!platform) continue;
    roms.push({
      folderPath: folder.path,
      primaryPath: file.fullPath,
      name: file.name,
      sizeBytes: file.sizeBytes,
      platform,
      ...(archived
        ? { archiveEntry: archived.name, romSizeBytes: archived.size }
        : {}),
    });
  }

  return roms;
};

export const scanRetroArchFolders = async (
  folders: RetroArchFolderInput[],
  signal?: { cancelled: boolean },
  onFolderScanned?: (scanned: number, total: number, kept: number) => void
): Promise<ScannedRetroArchRom[]> => {
  const collected: ScannedRetroArchRom[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < folders.length; i++) {
    if (signal?.cancelled) break;
    const roms = await scanRetroArchFolder(folders[i]);
    for (const rom of roms) {
      if (seen.has(rom.primaryPath)) continue;
      seen.add(rom.primaryPath);
      collected.push(rom);
    }
    onFolderScanned?.(i + 1, folders.length, collected.length);
  }
  return collected;
};
