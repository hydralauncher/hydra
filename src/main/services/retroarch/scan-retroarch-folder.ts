import type { RetroArchPlatform } from "@types";

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
}

export interface RetroArchFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export const scanRetroArchFolder = async (
  folder: RetroArchFolderInput
): Promise<ScannedRetroArchRom[]> => {
  const files = await collectFilesByExtension(
    folder.path,
    [...ALL_RETROARCH_ROM_EXTENSIONS],
    folder.scanSubfolders
  );

  const roms: ScannedRetroArchRom[] = [];
  for (const file of files) {
    const platform = extensionToPlatform(file.name);
    if (!platform) continue;
    roms.push({
      folderPath: folder.path,
      primaryPath: file.fullPath,
      name: file.name,
      sizeBytes: file.sizeBytes,
      platform,
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
  for (let i = 0; i < folders.length; i++) {
    if (signal?.cancelled) break;
    const roms = await scanRetroArchFolder(folders[i]);
    collected.push(...roms);
    onFolderScanned?.(i + 1, folders.length, collected.length);
  }
  return collected;
};
