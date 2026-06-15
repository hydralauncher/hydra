import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import {
  extractSkuFromSaveFolder,
  isSystemSaveFolder,
} from "./extract-save-sku";
import { DF } from "./types";
import type {
  Ps2CardInfo,
  Ps2DirEntry,
  Ps2Save,
  Ps2SaveContents,
  Ps2SaveFile,
  Superblock,
} from "./types";

/*
 * PS2 memory card (`.ps2`) reader. Pure Node (`fs`/`Buffer`) — no Electron/`@main`
 * imports — so it is usable from the standalone verification script.
 *
 * ── CLUSTER ADDRESSING (the one rule a reader must not get wrong) ───────────────
 *   ABSOLUTE cluster = index from the start of the card's cluster space (page 0).
 *   RELATIVE cluster = index within the allocatable region;
 *                      ABSOLUTE = superblock.allocOffset + RELATIVE.
 *
 *   ABSOLUTE values: superblock.ifcList[], the u32 contents of indirect-FAT
 *                    clusters, and any cluster actually read from the file.
 *   RELATIVE values: superblock.rootDirCluster, Ps2DirEntry.cluster, FAT
 *                    next-pointers (entry & 0x7FFFFFFF), and the index passed to
 *                    readFatEntry().
 *
 *   So: readFatEntry(relIdx) takes RELATIVE; reading a file/dir cluster reads the
 *   ABSOLUTE cluster `allocOffset + relativeCluster`.
 *
 *   FAT entry bits: bit31 set = cluster allocated; (entry & 0x7FFFFFFF) = next
 *   relative cluster; 0x7FFFFFFF = end of chain; top bit clear = free.
 */

const MAGIC = "Sony PS2 Memory Card Format ";
const SUPERBLOCK_BYTES = 0x154;
export const DIR_ENTRY_BYTES = 512;

export const FAT_ALLOCATED_BIT = 0x80000000;
export const FAT_VALUE_MASK = 0x7fffffff;
export const FAT_CHAIN_END = 0x7fffffff;

const MAX_CHAIN_STEPS = 8192; // FAT loop guard (an 8 MB card has 8192 clusters)
const MAX_DIR_ENTRIES = 8192; // safety cap on entries read from one directory
const MAX_SAVE_FILE_BYTES = 16 * 1024 * 1024; // per-file read cap

export interface EccDetection {
  hasEcc: boolean;
  rawPageSize: number; // on-disk bytes per page (pageLen, or pageLen + spare)
}

const parseTod = (buf: Buffer, off: number): number => {
  // ToD: [pad u8, sec, min, hour, day, month, year u16 LE]
  const sec = buf[off + 1];
  const min = buf[off + 2];
  const hour = buf[off + 3];
  const day = buf[off + 4];
  const month = buf[off + 5];
  const year = buf.readUInt16LE(off + 6);
  if (
    year < 1980 ||
    year > 3000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return 0;
  }
  const ms = Date.UTC(year, month - 1, day, hour, min, sec);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
};

export const parseDirEntry = (buf: Buffer, offset: number): Ps2DirEntry => {
  const mode = buf.readUInt16LE(offset);
  const length = buf.readUInt32LE(offset + 0x04);
  const createdRaw = Buffer.from(buf.subarray(offset + 0x08, offset + 0x10));
  const cluster = buf.readUInt32LE(offset + 0x10);
  const modifiedRaw = Buffer.from(buf.subarray(offset + 0x18, offset + 0x20));
  const nameBuf = buf.subarray(offset + 0x40, offset + 0x40 + 32);
  const nul = nameBuf.indexOf(0);
  const name = nameBuf
    .subarray(0, nul === -1 ? nameBuf.length : nul)
    .toString("latin1");
  return {
    mode,
    length,
    cluster,
    name,
    createdSecs: parseTod(createdRaw, 0),
    modifiedSecs: parseTod(modifiedRaw, 0),
    createdRaw,
    modifiedRaw,
    isDir: (mode & DF.DIR) !== 0,
    isFile: (mode & DF.FILE) !== 0,
    exists: (mode & DF.EXISTS) !== 0,
  };
};

export const readSuperblock = async (
  fh: FileHandle
): Promise<Superblock | null> => {
  const buf = Buffer.alloc(SUPERBLOCK_BYTES);
  const { bytesRead } = await fh.read(buf, 0, SUPERBLOCK_BYTES, 0);
  if (bytesRead < SUPERBLOCK_BYTES) return null;
  if (buf.toString("latin1", 0, MAGIC.length) !== MAGIC) return null;

  const pageLen = buf.readUInt16LE(0x28);
  const pagesPerCluster = buf.readUInt16LE(0x2a);
  if (pageLen <= 0 || pagesPerCluster <= 0) return null;

  const ifcList: number[] = [];
  for (let i = 0; i < 32; i += 1) ifcList.push(buf.readUInt32LE(0x50 + i * 4));

  const clusterSize = pageLen * pagesPerCluster;
  return {
    magic: MAGIC,
    pageLen,
    pagesPerCluster,
    pagesPerBlock: buf.readUInt16LE(0x2c),
    clustersPerCard: buf.readUInt32LE(0x30),
    allocOffset: buf.readUInt32LE(0x34),
    allocEnd: buf.readUInt32LE(0x38),
    rootDirCluster: buf.readUInt32LE(0x3c),
    ifcList,
    cardType: buf.readInt8(0x150),
    cardFlags: buf.readInt8(0x151),
    clusterSize,
    entriesPerCluster: Math.floor(clusterSize / 4),
  };
};

export const detectEcc = (
  fileSize: number,
  sb: Superblock
): EccDetection | null => {
  const spareSize = Math.floor(sb.pageLen / 128) * 4; // 16 for 512-byte pages
  const rawEcc = sb.pageLen + spareSize;
  const totalPages = sb.clustersPerCard * sb.pagesPerCluster;

  if (totalPages > 0) {
    if (fileSize === totalPages * rawEcc)
      return { hasEcc: true, rawPageSize: rawEcc };
    if (fileSize === totalPages * sb.pageLen) {
      return { hasEcc: false, rawPageSize: sb.pageLen };
    }
  }
  // Fallback for odd-sized/truncated dumps: prefer ECC stride when it divides
  // cleanly and the raw stride does not.
  if (rawEcc > 0 && fileSize % rawEcc === 0 && fileSize % sb.pageLen !== 0) {
    return { hasEcc: true, rawPageSize: rawEcc };
  }
  if (fileSize % sb.pageLen === 0)
    return { hasEcc: false, rawPageSize: sb.pageLen };
  return null;
};

class Ps2MemoryCard {
  private readonly fatCache = new Map<number, Buffer>();

  private constructor(
    readonly filePath: string,
    private readonly fh: FileHandle,
    readonly sb: Superblock,
    readonly hasEcc: boolean,
    readonly rawPageSize: number
  ) {}

  static async open(filePath: string): Promise<Ps2MemoryCard | null> {
    let fh: FileHandle | null = null;
    try {
      fh = await fs.open(filePath, "r");
      const stat = await fh.stat();
      const sb = await readSuperblock(fh);
      if (!sb) {
        await fh.close();
        return null;
      }
      const ecc = detectEcc(stat.size, sb);
      if (!ecc) {
        await fh.close();
        return null;
      }
      return new Ps2MemoryCard(filePath, fh, sb, ecc.hasEcc, ecc.rawPageSize);
    } catch {
      if (fh) await fh.close().catch(() => undefined);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.fh.close().catch(() => undefined);
  }

  private async readPage(pageIndex: number): Promise<Buffer> {
    const buf = Buffer.alloc(this.sb.pageLen);
    await this.fh.read(buf, 0, this.sb.pageLen, pageIndex * this.rawPageSize);
    return buf;
  }

  private async readCluster(absoluteCluster: number): Promise<Buffer> {
    const ppc = this.sb.pagesPerCluster;
    const pages: Buffer[] = [];
    for (let p = 0; p < ppc; p += 1) {
      pages.push(await this.readPage(absoluteCluster * ppc + p));
    }
    return Buffer.concat(pages);
  }

  // Indirect-FAT and FAT clusters are tiny and re-read constantly — memoize them.
  private async readClusterCached(absoluteCluster: number): Promise<Buffer> {
    const cached = this.fatCache.get(absoluteCluster);
    if (cached) return cached;
    const buf = await this.readCluster(absoluteCluster);
    this.fatCache.set(absoluteCluster, buf);
    return buf;
  }

  /** Returns the raw 32-bit FAT entry for a RELATIVE allocatable cluster index. */
  private async readFatEntry(relativeCluster: number): Promise<number> {
    const epc = this.sb.entriesPerCluster;
    const fatSlot = relativeCluster % epc;
    const fatClusterSelector = Math.floor(relativeCluster / epc);
    const indirectSlot = fatClusterSelector % epc;
    const indirectSelector = Math.floor(fatClusterSelector / epc);

    const indirectAbs = this.sb.ifcList[indirectSelector];
    if (indirectAbs === undefined) return 0;
    const indirectBuf = await this.readClusterCached(indirectAbs);
    const fatClusterAbs = indirectBuf.readUInt32LE(indirectSlot * 4);
    const fatBuf = await this.readClusterCached(fatClusterAbs);
    return fatBuf.readUInt32LE(fatSlot * 4);
  }

  /** Follows the FAT from a RELATIVE start cluster, returning RELATIVE clusters. */
  private async walkClusterChain(
    startRelative: number,
    maxClusters: number
  ): Promise<number[]> {
    const out: number[] = [];
    let cur = startRelative;
    for (let step = 0; step < MAX_CHAIN_STEPS; step += 1) {
      if (out.length >= maxClusters) break;
      if (cur < 0 || cur >= this.sb.clustersPerCard) break;
      const entry = await this.readFatEntry(cur);
      if ((entry & FAT_ALLOCATED_BIT) === 0) break; // cur not allocated
      out.push(cur);
      const next = entry & FAT_VALUE_MASK;
      if (next === FAT_CHAIN_END || next === cur) break;
      cur = next;
    }
    return out;
  }

  private async readChainBytes(
    startRelative: number,
    byteLength: number
  ): Promise<Buffer> {
    if (byteLength <= 0) return Buffer.alloc(0);
    const effective = Math.min(byteLength, MAX_SAVE_FILE_BYTES);
    const clustersNeeded = Math.ceil(effective / this.sb.clusterSize) + 1;
    const chain = await this.walkClusterChain(startRelative, clustersNeeded);

    const parts: Buffer[] = [];
    let remaining = effective;
    for (const rel of chain) {
      if (remaining <= 0) break;
      const cluster = await this.readCluster(this.sb.allocOffset + rel);
      const take = Math.min(this.sb.clusterSize, remaining);
      parts.push(cluster.subarray(0, take));
      remaining -= take;
    }
    return Buffer.concat(parts);
  }

  private async readDirectory(
    startRelative: number,
    entryCount: number
  ): Promise<Ps2DirEntry[]> {
    const entriesPerCluster = Math.floor(this.sb.clusterSize / DIR_ENTRY_BYTES);
    if (entriesPerCluster <= 0) return [];
    const want = Math.min(Math.max(entryCount, 0), MAX_DIR_ENTRIES);
    const clustersNeeded = Math.ceil(want / entriesPerCluster);
    const chain = await this.walkClusterChain(startRelative, clustersNeeded);

    const entries: Ps2DirEntry[] = [];
    for (const rel of chain) {
      const cluster = await this.readCluster(this.sb.allocOffset + rel);
      for (
        let off = 0;
        off + DIR_ENTRY_BYTES <= cluster.length;
        off += DIR_ENTRY_BYTES
      ) {
        if (entries.length >= want) break;
        entries.push(parseDirEntry(cluster, off));
      }
      if (entries.length >= want) break;
    }
    return entries;
  }

  // The root directory's entry count is not in the superblock — it lives in the
  // root's own "." self-entry, which we read from the first root cluster.
  private async readRootEntries(): Promise<Ps2DirEntry[]> {
    const firstCluster = await this.readCluster(
      this.sb.allocOffset + this.sb.rootDirCluster
    );
    const dot = parseDirEntry(firstCluster, 0);
    return this.readDirectory(this.sb.rootDirCluster, dot.length);
  }

  async listSaves(): Promise<Ps2Save[]> {
    const rootEntries = await this.readRootEntries();
    const saves: Ps2Save[] = [];
    for (const entry of rootEntries) {
      if (!entry.exists || !entry.isDir) continue;
      if (isSystemSaveFolder(entry.name)) continue;

      const children = await this.readDirectory(entry.cluster, entry.length);
      let fileCount = 0;
      let sizeBytes = 0;
      for (const child of children) {
        if (!child.exists || !child.isFile) continue;
        if (child.name === "." || child.name === "..") continue;
        fileCount += 1;
        sizeBytes += child.length;
      }

      saves.push({
        folderName: entry.name,
        sku: extractSkuFromSaveFolder(entry.name),
        fileCount,
        sizeBytes,
        mode: entry.mode,
        createdSecs: entry.createdSecs,
        modifiedSecs: entry.modifiedSecs,
        createdRaw: entry.createdRaw,
        modifiedRaw: entry.modifiedRaw,
      });
    }
    return saves;
  }

  async readSaveContents(folderName: string): Promise<Ps2SaveContents | null> {
    const rootEntries = await this.readRootEntries();
    const folder = rootEntries.find(
      (entry) => entry.exists && entry.isDir && entry.name === folderName
    );
    if (!folder) return null;

    const children = await this.readDirectory(folder.cluster, folder.length);
    const files: Ps2SaveFile[] = [];
    for (const child of children) {
      if (!child.exists || !child.isFile) continue;
      if (child.name === "." || child.name === "..") continue;
      const data = await this.readChainBytes(child.cluster, child.length);
      files.push({
        name: child.name,
        length: child.length,
        mode: child.mode,
        createdSecs: child.createdSecs,
        modifiedSecs: child.modifiedSecs,
        createdRaw: child.createdRaw,
        modifiedRaw: child.modifiedRaw,
        data,
      });
    }

    return {
      folderName: folder.name,
      folderMode: folder.mode,
      folderCreatedRaw: folder.createdRaw,
      folderModifiedRaw: folder.modifiedRaw,
      files,
    };
  }
}

/**
 * Open a `.ps2` image and list its game save folders. Returns `null` if the file
 * is not a readable PS2 memory card (bad magic, unrecognized size, read error).
 */
export const listSaves = async (
  filePath: string
): Promise<Ps2CardInfo | null> => {
  const card = await Ps2MemoryCard.open(filePath);
  if (!card) return null;
  try {
    const saves = await card.listSaves();
    return {
      filePath,
      hasEcc: card.hasEcc,
      rawPageSize: card.rawPageSize,
      superblock: card.sb,
      saves,
    };
  } catch {
    return null;
  } finally {
    await card.close();
  }
};

/** Read every file inside one save folder (with bytes), for `.psu` export. */
export const readSaveContents = async (
  filePath: string,
  folderName: string
): Promise<Ps2SaveContents | null> => {
  const card = await Ps2MemoryCard.open(filePath);
  if (!card) return null;
  try {
    return await card.readSaveContents(folderName);
  } catch {
    return null;
  } finally {
    await card.close();
  }
};
