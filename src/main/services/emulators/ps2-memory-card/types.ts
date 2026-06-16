/**
 * Type definitions for the PS2 memory card (`.ps2`) on-disk format.
 *
 * Pure types + flag constants only — no runtime dependencies — so the parser,
 * the `.psu` writer and the standalone verification script stay alias-free.
 *
 * Format reference: the public-domain `mymc` / `mymcplus` tools.
 */

/** Directory-entry mode bits (DF = "directory flags"). */
export const DF = {
  READ: 0x0001,
  WRITE: 0x0002,
  EXECUTE: 0x0004,
  PROTECTED: 0x0008,
  FILE: 0x0010,
  DIR: 0x0020,
  POCKETSTN: 0x0800,
  PSX: 0x1000,
  HIDDEN: 0x2000,
  EXISTS: 0x8000,
} as const;

export interface Superblock {
  magic: string; // "Sony PS2 Memory Card Format "
  pageLen: number; // bytes per logical page (512)
  pagesPerCluster: number; // 2
  pagesPerBlock: number; // 16 (erase block)
  clustersPerCard: number; // 8192 for an 8 MB card
  allocOffset: number; // ABSOLUTE cluster index where the data region begins
  allocEnd: number; // ABSOLUTE, one past the last allocatable cluster
  rootDirCluster: number; // RELATIVE to allocOffset (usually 0)
  ifcList: number[]; // u32[32] ABSOLUTE indirect-FAT cluster indices
  cardType: number; // expect 2 (PS2)
  cardFlags: number;
  clusterSize: number; // derived: pageLen * pagesPerCluster (1024)
  entriesPerCluster: number; // derived: clusterSize / 4 (256)
}

export interface Ps2DirEntry {
  mode: number;
  length: number; // file: byte length; dir: child entry count
  cluster: number; // RELATIVE to allocOffset (first cluster of the entry)
  name: string;
  createdSecs: number; // epoch seconds (for display)
  modifiedSecs: number; // epoch seconds (for display)
  createdRaw: Buffer; // raw 8-byte ToD (copied verbatim into .psu)
  modifiedRaw: Buffer;
  isDir: boolean;
  isFile: boolean;
  exists: boolean;
}

/** One game save folder on the card (metadata only — no file contents). */
export interface Ps2Save {
  folderName: string; // e.g. "BESLES-50009"
  sku: string | null; // normalized "SLES-50009", or null if unrecognized
  fileCount: number;
  sizeBytes: number; // sum of contained file lengths
  mode: number;
  createdSecs: number;
  modifiedSecs: number;
  createdRaw: Buffer;
  modifiedRaw: Buffer;
}

/** One file inside a save folder, with its bytes (used for export). */
export interface Ps2SaveFile {
  name: string;
  length: number;
  mode: number;
  createdSecs: number;
  modifiedSecs: number;
  createdRaw: Buffer;
  modifiedRaw: Buffer;
  data: Buffer;
}

/** A save folder's full contents — the input to the `.psu` writer. */
export interface Ps2SaveContents {
  folderName: string;
  folderMode: number;
  folderCreatedRaw: Buffer;
  folderModifiedRaw: Buffer;
  files: Ps2SaveFile[];
}

export interface Ps2CardInfo {
  filePath: string;
  hasEcc: boolean;
  rawPageSize: number; // 512 (no ECC) or 528 (ECC)
  superblock: Superblock;
  saves: Ps2Save[];
}
