import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { computePageSpare } from "./ecc";
import {
  DIR_ENTRY_BYTES,
  FAT_ALLOCATED_BIT,
  FAT_VALUE_MASK,
  detectEcc,
  listSaves,
  parseDirEntry,
  readSaveContents,
  readSuperblock,
} from "./ps2-memory-card";
import { DF } from "./types";
import type { Ps2DirEntry, Superblock } from "./types";

/*
 * PS2 memory card WRITER — imports a `.psu` save folder back into a `.ps2`
 * image. The inverse of the read-only parser; field semantics and the FAT
 * encoding follow the public-domain `mymc` (ps2mc.py):
 *   allocated end-of-chain entry = 0xFFFFFFFF
 *   allocated mid-chain entry     = 0x80000000 | nextRelativeCluster
 *   free entry                    = 0x7FFFFFFF (bit31 clear)
 * Directory clusters hold 512-byte entries (2 per 1024-byte cluster) in the
 * order [".", "..", file0, file1, …]; file/dir `cluster` fields are RELATIVE to
 * allocOffset. The superblock keeps no free-cluster count, so nothing else needs
 * updating. On ECC cards every written page's 16-byte spare is recomputed.
 */

const FAT_END = (FAT_ALLOCATED_BIT | FAT_VALUE_MASK) >>> 0; // 0xFFFFFFFF
const FAT_FREE = FAT_VALUE_MASK; // 0x7FFFFFFF
const EMPTY_FILE_CLUSTER = 0xffffffff; // sentinel for a zero-length file

const DF_0400 = 0x0400;
const DF_RWX = DF.READ | DF.WRITE | DF.EXECUTE;
const DIR_MODE = DF_RWX | DF_0400 | DF.DIR | DF.EXISTS;
const DOTDOT_MODE =
  DF.WRITE | DF.EXECUTE | DF.DIR | DF_0400 | DF.HIDDEN | DF.EXISTS;

interface PsuFile {
  name: string;
  mode: number;
  length: number;
  createdRaw: Buffer;
  modifiedRaw: Buffer;
  data: Buffer;
}

interface PsuContents {
  folderName: string;
  folderMode: number;
  folderCreatedRaw: Buffer;
  folderModifiedRaw: Buffer;
  files: PsuFile[];
}

const cstr = (buf: Buffer, off: number, max: number): string => {
  const slice = buf.subarray(off, off + max);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("latin1");
};

const padTo1024 = (len: number): number => Math.ceil(len / 1024) * 1024;

/** Reverse of `buildPsuBuffer`: a flat run of 512-byte records + 1024-padded data. */
export const parsePsuBuffer = (buf: Buffer): PsuContents | null => {
  if (buf.length < DIR_ENTRY_BYTES * 3) return null;
  const readRecord = (off: number) => ({
    mode: buf.readUInt16LE(off),
    length: buf.readUInt32LE(off + 0x04),
    createdRaw: Buffer.from(buf.subarray(off + 0x08, off + 0x10)),
    modifiedRaw: Buffer.from(buf.subarray(off + 0x18, off + 0x20)),
    name: cstr(buf, off + 0x40, 32),
  });

  const folder = readRecord(0);
  if ((folder.mode & DF.DIR) === 0 || !folder.name) return null;

  const files: PsuFile[] = [];
  let off = DIR_ENTRY_BYTES * 3; // skip folder, ".", ".."
  while (off + DIR_ENTRY_BYTES <= buf.length) {
    const rec = readRecord(off);
    off += DIR_ENTRY_BYTES;
    if ((rec.mode & DF.FILE) === 0) break; // trailing/garbage guard
    const data = Buffer.from(buf.subarray(off, off + rec.length));
    off += padTo1024(rec.length);
    files.push({
      name: rec.name,
      mode: rec.mode,
      length: rec.length,
      createdRaw: rec.createdRaw,
      modifiedRaw: rec.modifiedRaw,
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
};

const writeDirEntry = (
  buf: Buffer,
  off: number,
  e: {
    mode: number;
    length: number;
    cluster: number;
    name: string;
    createdRaw: Buffer;
    modifiedRaw: Buffer;
    dirEntryIndex?: number;
  }
): void => {
  buf.fill(0, off, off + DIR_ENTRY_BYTES);
  buf.writeUInt16LE(e.mode & 0xffff, off + 0x00);
  buf.writeUInt32LE(e.length >>> 0, off + 0x04);
  e.createdRaw.copy(buf, off + 0x08, 0, Math.min(e.createdRaw.length, 8));
  buf.writeUInt32LE(e.cluster >>> 0, off + 0x10);
  buf.writeUInt32LE((e.dirEntryIndex ?? 0) >>> 0, off + 0x14);
  e.modifiedRaw.copy(buf, off + 0x18, 0, Math.min(e.modifiedRaw.length, 8));
  const nameBuf = Buffer.from(e.name, "latin1");
  nameBuf.copy(buf, off + 0x40, 0, Math.min(nameBuf.length, 32));
};

class Ps2CardWriter {
  private constructor(
    private readonly fh: FileHandle,
    readonly sb: Superblock,
    readonly hasEcc: boolean,
    readonly rawPageSize: number
  ) {}

  static async open(filePath: string): Promise<Ps2CardWriter | null> {
    let fh: FileHandle | null = null;
    try {
      fh = await fs.open(filePath, "r+");
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
      return new Ps2CardWriter(fh, sb, ecc.hasEcc, ecc.rawPageSize);
    } catch {
      if (fh) await fh.close().catch(() => undefined);
      return null;
    }
  }

  close(): Promise<void> {
    return this.fh.close().catch(() => undefined);
  }

  private async readPage(pageIndex: number): Promise<Buffer> {
    const buf = Buffer.alloc(this.sb.pageLen);
    await this.fh.read(buf, 0, this.sb.pageLen, pageIndex * this.rawPageSize);
    return buf;
  }

  private async writePage(pageIndex: number, data: Buffer): Promise<void> {
    const base = pageIndex * this.rawPageSize;
    await this.fh.write(data, 0, this.sb.pageLen, base);
    if (this.hasEcc) {
      const spareSize = this.rawPageSize - this.sb.pageLen;
      const spare = computePageSpare(data, spareSize);
      await this.fh.write(spare, 0, spareSize, base + this.sb.pageLen);
    }
  }

  private async readCluster(absoluteCluster: number): Promise<Buffer> {
    const ppc = this.sb.pagesPerCluster;
    const pages: Buffer[] = [];
    for (let p = 0; p < ppc; p += 1) {
      pages.push(await this.readPage(absoluteCluster * ppc + p));
    }
    return Buffer.concat(pages);
  }

  private async writeCluster(
    absoluteCluster: number,
    buf: Buffer
  ): Promise<void> {
    const ppc = this.sb.pagesPerCluster;
    for (let p = 0; p < ppc; p += 1) {
      const start = p * this.sb.pageLen;
      await this.writePage(
        absoluteCluster * ppc + p,
        buf.subarray(start, start + this.sb.pageLen)
      );
    }
  }

  private abs(relativeCluster: number): number {
    return this.sb.allocOffset + relativeCluster;
  }

  private async readFatEntry(relativeCluster: number): Promise<number> {
    const epc = this.sb.entriesPerCluster;
    const fatSlot = relativeCluster % epc;
    const fatClusterSelector = Math.floor(relativeCluster / epc);
    const indirectSlot = fatClusterSelector % epc;
    const indirectSelector = Math.floor(fatClusterSelector / epc);
    const indirectAbs = this.sb.ifcList[indirectSelector];
    if (indirectAbs === undefined) return 0;
    const indirectBuf = await this.readCluster(indirectAbs);
    const fatClusterAbs = indirectBuf.readUInt32LE(indirectSlot * 4);
    const fatBuf = await this.readCluster(fatClusterAbs);
    return fatBuf.readUInt32LE(fatSlot * 4);
  }

  private async writeFatEntry(
    relativeCluster: number,
    value: number
  ): Promise<void> {
    const epc = this.sb.entriesPerCluster;
    const fatSlot = relativeCluster % epc;
    const fatClusterSelector = Math.floor(relativeCluster / epc);
    const indirectSlot = fatClusterSelector % epc;
    const indirectSelector = Math.floor(fatClusterSelector / epc);
    const indirectAbs = this.sb.ifcList[indirectSelector];
    if (indirectAbs === undefined) throw new Error("FAT index out of range");
    const indirectBuf = await this.readCluster(indirectAbs);
    const fatClusterAbs = indirectBuf.readUInt32LE(indirectSlot * 4);
    const fatBuf = await this.readCluster(fatClusterAbs);
    fatBuf.writeUInt32LE(value >>> 0, fatSlot * 4);
    await this.writeCluster(fatClusterAbs, fatBuf);
  }

  private async walkChain(startRel: number, max: number): Promise<number[]> {
    const out: number[] = [];
    let cur = startRel;
    for (let step = 0; step < max + 1; step += 1) {
      if (cur < 0 || cur >= this.sb.clustersPerCard) break;
      const entry = await this.readFatEntry(cur);
      if ((entry & FAT_ALLOCATED_BIT) === 0) break;
      out.push(cur);
      const next = entry & FAT_VALUE_MASK;
      if (next === FAT_VALUE_MASK || next === cur) break;
      cur = next;
    }
    return out;
  }

  /** Number of allocatable (RELATIVE) clusters: those with a valid abs cluster. */
  private get allocatableClusters(): number {
    return this.sb.clustersPerCard - this.sb.allocOffset;
  }

  /** Scan the allocatable region for `count` free RELATIVE clusters. */
  private async findFreeClusters(count: number): Promise<number[] | null> {
    const out: number[] = [];
    const max = this.allocatableClusters;
    for (let rel = 0; rel < max && out.length < count; rel += 1) {
      const entry = await this.readFatEntry(rel);
      if ((entry & FAT_ALLOCATED_BIT) === 0) out.push(rel);
    }
    return out.length === count ? out : null;
  }

  private async setChain(rels: number[]): Promise<void> {
    for (let i = 0; i < rels.length; i += 1) {
      const value =
        i === rels.length - 1
          ? FAT_END
          : (FAT_ALLOCATED_BIT | (rels[i + 1] & FAT_VALUE_MASK)) >>> 0;
      await this.writeFatEntry(rels[i], value);
    }
  }

  private async freeChain(startRel: number): Promise<void> {
    const chain = await this.walkChain(startRel, this.sb.clustersPerCard);
    for (const rel of chain) await this.writeFatEntry(rel, FAT_FREE);
  }

  /** Read `count` directory entries starting at a RELATIVE cluster. */
  private async readDirEntries(startRel: number, count: number) {
    const perCluster = Math.floor(this.sb.clusterSize / DIR_ENTRY_BYTES);
    const clustersNeeded = Math.max(1, Math.ceil(count / perCluster));
    const chain = await this.walkChain(startRel, clustersNeeded);
    const entries: ReturnType<typeof parseDirEntry>[] = [];
    for (const rel of chain) {
      const cluster = await this.readCluster(this.abs(rel));
      for (
        let o = 0;
        o + DIR_ENTRY_BYTES <= cluster.length && entries.length < count;
        o += DIR_ENTRY_BYTES
      ) {
        entries.push(parseDirEntry(cluster, o));
      }
    }
    return { entries, chain };
  }

  private async writeRootEntry(
    rootChain: number[],
    index: number,
    entry: Parameters<typeof writeDirEntry>[2]
  ): Promise<void> {
    const perCluster = Math.floor(this.sb.clusterSize / DIR_ENTRY_BYTES);
    const clusterIdx = Math.floor(index / perCluster);
    const offset = (index % perCluster) * DIR_ENTRY_BYTES;
    const absCluster = this.abs(rootChain[clusterIdx]);
    const buf = await this.readCluster(absCluster);
    writeDirEntry(buf, offset, entry);
    await this.writeCluster(absCluster, buf);
  }

  // Bump the root directory's entry count (its "." self-entry length, at the
  // very first root entry).
  private async setRootCount(
    rootChain: number[],
    count: number
  ): Promise<void> {
    const absCluster = this.abs(rootChain[0]);
    const buf = await this.readCluster(absCluster);
    buf.writeUInt32LE(count >>> 0, 0x04);
    await this.writeCluster(absCluster, buf);
  }

  private async freeExistingFolder(old: Ps2DirEntry): Promise<void> {
    const { entries: oldChildren } = await this.readDirEntries(
      old.cluster,
      old.length
    );
    for (const child of oldChildren) {
      if (child.isFile && child.exists && child.length > 0) {
        await this.freeChain(child.cluster);
      }
    }
    await this.freeChain(old.cluster);
  }

  private async writeFolderDirectory(
    psu: PsuContents,
    targetIndex: number,
    dirRels: number[],
    fileRels: number[][],
    entryCount: number,
    clusterSize: number
  ): Promise<void> {
    const dirClusters = dirRels.length;
    const dirBuf = Buffer.alloc(dirClusters * clusterSize);
    writeDirEntry(dirBuf, 0 * DIR_ENTRY_BYTES, {
      mode: DIR_MODE,
      length: entryCount,
      cluster: this.sb.rootDirCluster,
      dirEntryIndex: targetIndex,
      name: ".",
      createdRaw: psu.folderCreatedRaw,
      modifiedRaw: psu.folderModifiedRaw,
    });
    writeDirEntry(dirBuf, 1 * DIR_ENTRY_BYTES, {
      mode: DOTDOT_MODE,
      length: 0,
      cluster: 0,
      name: "..",
      createdRaw: psu.folderCreatedRaw,
      modifiedRaw: psu.folderModifiedRaw,
    });
    psu.files.forEach((f, i) => {
      writeDirEntry(dirBuf, (i + 2) * DIR_ENTRY_BYTES, {
        mode: (f.mode | DF.FILE | DF.EXISTS) & 0xffff,
        length: f.length,
        cluster: fileRels[i].length ? fileRels[i][0] : EMPTY_FILE_CLUSTER,
        name: f.name,
        createdRaw: f.createdRaw,
        modifiedRaw: f.modifiedRaw,
      });
    });
    for (let c = 0; c < dirClusters; c += 1) {
      await this.writeCluster(
        this.abs(dirRels[c]),
        dirBuf.subarray(c * clusterSize, (c + 1) * clusterSize)
      );
    }
  }

  private async writeFileData(
    fileRels: number[][],
    files: PsuFile[],
    clusterSize: number
  ): Promise<void> {
    for (let i = 0; i < files.length; i += 1) {
      const rels = fileRels[i];
      const data = files[i].data;
      for (let c = 0; c < rels.length; c += 1) {
        const chunk = data.subarray(c * clusterSize, (c + 1) * clusterSize);
        const clusterBuf = Buffer.alloc(clusterSize);
        chunk.copy(clusterBuf);
        await this.writeCluster(this.abs(rels[c]), clusterBuf);
      }
    }
  }

  private async growRootChain(
    rootChain: number[],
    rootGrowthRel: number,
    clusterSize: number
  ): Promise<number[]> {
    await this.writeFatEntry(rootGrowthRel, FAT_END);
    const lastRoot = rootChain.at(-1) ?? rootChain[0];
    await this.writeFatEntry(
      lastRoot,
      (FAT_ALLOCATED_BIT | (rootGrowthRel & FAT_VALUE_MASK)) >>> 0
    );
    await this.writeCluster(this.abs(rootGrowthRel), Buffer.alloc(clusterSize));
    return [...rootChain, rootGrowthRel];
  }

  async importFolder(psu: PsuContents): Promise<void> {
    const { clusterSize } = this.sb;
    const perCluster = Math.floor(clusterSize / DIR_ENTRY_BYTES); // 2

    // Root bootstrap: count + every entry, and its cluster chain.
    const rootFirst = await this.readCluster(this.abs(this.sb.rootDirCluster));
    const rootCount = parseDirEntry(rootFirst, 0).length;
    const { entries: rootEntries, chain: rootChain } =
      await this.readDirEntries(this.sb.rootDirCluster, rootCount);

    const existingIdx = rootEntries.findIndex(
      (e) => e.exists && e.isDir && e.name === psu.folderName
    );
    if (existingIdx !== -1) {
      await this.freeExistingFolder(rootEntries[existingIdx]);
    }

    // How many clusters does the new folder need?
    const entryCount = psu.files.length + 2; // ".", "..", files
    const dirClusters = Math.ceil(entryCount / perCluster);
    const fileClusterCounts = psu.files.map((f) =>
      Math.ceil(f.length / clusterSize)
    );
    const totalFileClusters = fileClusterCounts.reduce((a, b) => a + b, 0);

    // A brand-new entry that lands past the current root count may need the root
    // directory itself to grow by one cluster.
    const targetIndex = existingIdx === -1 ? rootCount : existingIdx;
    const needsRootGrowth =
      existingIdx === -1 && targetIndex % perCluster === 0;

    const need = dirClusters + totalFileClusters + (needsRootGrowth ? 1 : 0);
    const free = await this.findFreeClusters(need);
    if (!free) throw new Error("Not enough free space on the memory card");

    let cursor = 0;
    const dirRels = free.slice(cursor, cursor + dirClusters);
    cursor += dirClusters;
    const fileRels = psu.files.map((_, i) => {
      const n = fileClusterCounts[i];
      const rels = free.slice(cursor, cursor + n);
      cursor += n;
      return rels;
    });
    const rootGrowthRel = needsRootGrowth ? free[cursor++] : null;

    // FAT: chain the folder's dir clusters and each file's data clusters.
    await this.setChain(dirRels);
    for (const rels of fileRels) if (rels.length) await this.setChain(rels);

    await this.writeFolderDirectory(
      psu,
      targetIndex,
      dirRels,
      fileRels,
      entryCount,
      clusterSize
    );
    await this.writeFileData(fileRels, psu.files, clusterSize);

    const effectiveRootChain =
      rootGrowthRel !== null
        ? await this.growRootChain(rootChain, rootGrowthRel, clusterSize)
        : rootChain;

    // Write the folder's entry into the root directory and bump the root count.
    await this.writeRootEntry(effectiveRootChain, targetIndex, {
      mode: (psu.folderMode | DF.DIR | DF.EXISTS) & 0xffff,
      length: entryCount,
      cluster: dirRels[0],
      name: psu.folderName,
      createdRaw: psu.folderCreatedRaw,
      modifiedRaw: psu.folderModifiedRaw,
    });
    if (existingIdx === -1) {
      await this.setRootCount(effectiveRootChain, rootCount + 1);
    }
  }
}

export interface Ps2ImportResult {
  ok: boolean;
  error?: string;
  folderName?: string;
}

const verifyImportedFolder = async (
  cardFilePath: string,
  psu: PsuContents
): Promise<boolean> => {
  const info = await listSaves(cardFilePath);
  if (!info?.saves.some((s) => s.folderName === psu.folderName)) return false;

  const contents = await readSaveContents(cardFilePath, psu.folderName);
  if (!contents) return false;
  if (contents.files.length !== psu.files.length) return false;
  return psu.files.every((f) => {
    const got = contents.files.find((c) => c.name === f.name);
    if (!got) return false;
    return got.data.length === f.length && got.data.equals(f.data);
  });
};

/**
 * Import a `.psu` save folder into a `.ps2` card, replacing a same-named folder.
 * Backs the card up to `<card>.hydra-bak` first and restores it on any failure;
 * verifies the result by re-reading the folder before returning success.
 */
export const importPsuIntoCard = async (
  cardFilePath: string,
  psuBuffer: Buffer
): Promise<Ps2ImportResult> => {
  const psu = parsePsuBuffer(psuBuffer);
  if (!psu) return { ok: false, error: "Invalid .psu data" };

  const backupPath = `${cardFilePath}.hydra-bak`;
  try {
    await fs.copyFile(cardFilePath, backupPath);
  } catch (err) {
    return {
      ok: false,
      error: `Could not back up card: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const writer = await Ps2CardWriter.open(cardFilePath);
  if (!writer) {
    await fs.rm(backupPath, { force: true }).catch(() => undefined);
    return { ok: false, error: "Not a writable PS2 memory card" };
  }

  try {
    await writer.importFolder(psu);
    await writer.close();
  } catch (err) {
    await writer.close().catch(() => undefined);
    await fs.copyFile(backupPath, cardFilePath).catch(() => undefined);
    await fs.rm(backupPath, { force: true }).catch(() => undefined);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!(await verifyImportedFolder(cardFilePath, psu))) {
    await fs.copyFile(backupPath, cardFilePath).catch(() => undefined);
    await fs.rm(backupPath, { force: true }).catch(() => undefined);
    return { ok: false, error: "Import verification failed" };
  }

  await fs.rm(backupPath, { force: true }).catch(() => undefined);
  return { ok: true, folderName: psu.folderName };
};
