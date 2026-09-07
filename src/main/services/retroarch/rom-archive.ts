import type { RetroArchPlatform } from "@types";
import type { ArchiveEntry } from "../archive-entry.js";
import { RETROARCH_ARCHIVE_EXTENSIONS } from "../../../shared/retroarch-platform.js";
import { extensionToPlatform } from "./retroarch-cores.js";

// The supported cartridge platforms fit within this bound, including large hacks.
export const MAX_ARCHIVED_ROM_BYTES = 128 * 1024 * 1024;

export const isRetroArchArchive = (filePath: string): boolean =>
  RETROARCH_ARCHIVE_EXTENSIONS.some((ext) =>
    filePath.toLowerCase().endsWith(ext)
  );

export interface ArchivedRom extends ArchiveEntry {
  platform: RetroArchPlatform;
}

export const selectArchivedRom = (
  entries: ArchiveEntry[]
): ArchivedRom | null => {
  const roms = entries.flatMap((entry) => {
    const platform = extensionToPlatform(entry.name);
    return platform ? [{ ...entry, platform }] : [];
  });
  // A bare archive must refer to one game. Never map a collection to whichever
  // ROM happens to be listed first, since RetroArch may load a different one.
  if (roms.length !== 1) return null;
  const rom = roms[0];
  if (rom.encrypted || rom.size <= 0 || rom.size > MAX_ARCHIVED_ROM_BYTES)
    return null;
  return rom;
};

export const inspectRomArchive = async (
  filePath: string
): Promise<ArchivedRom | null> => {
  if (!isRetroArchArchive(filePath)) return null;
  try {
    const { SevenZip } = await import("../7zip");
    return selectArchivedRom(await SevenZip.listEntries(filePath));
  } catch {
    return null;
  }
};
