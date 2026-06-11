import { promises as fs } from "node:fs";

import { DF } from "./types";
import type { Ps2SaveContents } from "./types";

/*
 * `.psu` (EMS) export writer.
 *
 * A `.psu` file is a flat concatenation of 512-byte directory-entry records and
 * file data padded to the next 1024-byte boundary:
 *
 *   [dir record]                      length = fileCount + 2
 *   [ "." record ] [ ".." record ]    length = 0
 *   for each file: [file record] [file data ... zero-padded to 1024]
 *
 * Only file DATA is padded — the 512-byte records are never padded. Record field
 * offsets match an on-card directory entry; the on-card `cluster` field (0x10) is
 * meaningless in a `.psu` and is left zeroed.
 *
 * `buildPsuBuffer` is pure (no I/O). File writing happens only through a
 * `MemoryCardBackupTarget`, the seam where a future cloud uploader slots in.
 */

const PSU_RECORD_BYTES = 512;
const PSU_DATA_ALIGN = 1024;
const PSU_NAME_OFFSET = 0x40;
const PSU_NAME_MAX = 32;

const copyTod = (
  raw: Buffer | undefined,
  dest: Buffer,
  offset: number
): void => {
  if (raw?.length) raw.copy(dest, offset, 0, Math.min(raw.length, 8));
};

const writePsuRecord = (
  mode: number,
  length: number,
  name: string,
  createdRaw: Buffer,
  modifiedRaw: Buffer
): Buffer => {
  const rec = Buffer.alloc(PSU_RECORD_BYTES);
  rec.writeUInt16LE(mode & 0xffff, 0x00);
  rec.writeUInt32LE(length >>> 0, 0x04);
  copyTod(createdRaw, rec, 0x08);
  // 0x10 (cluster) and 0x14 left zero.
  copyTod(modifiedRaw, rec, 0x18);
  const nameBuf = Buffer.from(name, "latin1");
  nameBuf.copy(rec, PSU_NAME_OFFSET, 0, Math.min(nameBuf.length, PSU_NAME_MAX));
  return rec;
};

const padTo1024 = (dataLength: number): number =>
  (PSU_DATA_ALIGN - (dataLength % PSU_DATA_ALIGN)) % PSU_DATA_ALIGN;

/** Build a complete `.psu` image for one save folder. Pure — no file I/O. */
export const buildPsuBuffer = (contents: Ps2SaveContents): Buffer => {
  const { folderName, folderMode, folderCreatedRaw, folderModifiedRaw, files } =
    contents;
  const dirMode = (folderMode | DF.DIR | DF.EXISTS) & 0xffff;

  const parts: Buffer[] = [
    writePsuRecord(
      dirMode,
      files.length + 2,
      folderName,
      folderCreatedRaw,
      folderModifiedRaw
    ),
    writePsuRecord(dirMode, 0, ".", folderCreatedRaw, folderModifiedRaw),
    writePsuRecord(dirMode, 0, "..", folderCreatedRaw, folderModifiedRaw),
  ];

  for (const file of files) {
    const fileMode = (file.mode | DF.FILE | DF.EXISTS) & 0xffff;
    parts.push(
      writePsuRecord(
        fileMode,
        file.length,
        file.name,
        file.createdRaw,
        file.modifiedRaw
      ),
      file.data
    );
    const pad = padTo1024(file.data.length);
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }

  return Buffer.concat(parts);
};

/**
 * Destination for an exported save bundle. `LocalPsuBackup` writes to disk now;
 * a future `CloudPsuBackup` (presigned-URL upload) can implement the same shape
 * without touching the parser, IPC, or UI.
 */
export interface MemoryCardBackupTarget {
  /** Persist `data` and return a user-facing location (a path now, a URL later). */
  write(fileName: string, data: Buffer): Promise<string>;
}

export class LocalPsuBackup implements MemoryCardBackupTarget {
  constructor(private readonly destPath: string) {}

  async write(_fileName: string, data: Buffer): Promise<string> {
    await fs.writeFile(this.destPath, data);
    return this.destPath;
  }
}

export interface ExportSaveDeps {
  readSaveContents: (
    filePath: string,
    folderName: string
  ) => Promise<Ps2SaveContents | null>;
}

const sanitizeFileName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, "_") || "save";

/**
 * Read one save folder and write it as a `.psu` through `target`. The only
 * export-path function that performs I/O — and it does so via the seam.
 */
export const exportSaveToPsu = async (
  cardFilePath: string,
  folderName: string,
  target: MemoryCardBackupTarget,
  deps: ExportSaveDeps
): Promise<{ fileName: string; location: string; sizeBytes: number }> => {
  const contents = await deps.readSaveContents(cardFilePath, folderName);
  if (!contents) {
    throw new Error(`Save "${folderName}" not found on ${cardFilePath}`);
  }
  const buffer = buildPsuBuffer(contents);
  const fileName = `${sanitizeFileName(folderName)}.psu`;
  const location = await target.write(fileName, buffer);
  return { fileName, location, sizeBytes: buffer.length };
};
