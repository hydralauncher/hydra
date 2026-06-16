import type { MemoryCardBackupTarget } from "../ps2-memory-card/psu-export";
import type { Ps1SaveContents } from "./types";

/*
 * `.mcs` (single memory-card save) export writer.
 *
 * A `.mcs` file is the first block's 128-byte directory frame followed by the
 * save's raw 8 KB data blocks in chain order:
 *
 *   [128-byte directory frame][block 0 ... 8192][block 1 ... 8192] ...
 *
 * This is the de-facto interchange format read by MemcardRex, PSXMemTool and
 * the PS3 memory-card utilities, and re-importable into DuckStation.
 *
 * `buildMcsBuffer` is pure (no I/O). File writing happens only through a
 * `MemoryCardBackupTarget` — the same seam the PS2 `.psu` writer uses, so a
 * future cloud uploader slots in without touching the parser, IPC or UI.
 */

/** Build a complete `.mcs` image for one save. Pure — no file I/O. */
export const buildMcsBuffer = (contents: Ps1SaveContents): Buffer =>
  Buffer.concat([contents.headerFrame, ...contents.blocks]);

export interface Ps1ExportSaveDeps {
  readSaveContents: (
    filePath: string,
    identifier: string
  ) => Promise<Ps1SaveContents | null>;
}

const sanitizeFileName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, "_") || "save";

/**
 * Read one save and write it as a `.mcs` through `target`. The only export-path
 * function that performs I/O — and it does so via the backup seam.
 */
export const exportSaveToMcs = async (
  cardFilePath: string,
  identifier: string,
  target: MemoryCardBackupTarget,
  deps: Ps1ExportSaveDeps
): Promise<{ fileName: string; location: string; sizeBytes: number }> => {
  const contents = await deps.readSaveContents(cardFilePath, identifier);
  if (!contents) {
    throw new Error(`Save "${identifier}" not found on ${cardFilePath}`);
  }
  const buffer = buildMcsBuffer(contents);
  const fileName = `${sanitizeFileName(identifier)}.mcs`;
  const location = await target.write(fileName, buffer);
  return { fileName, location, sizeBytes: buffer.length };
};
