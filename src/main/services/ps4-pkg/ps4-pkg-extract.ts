import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import {
  XTS_SECTOR_SIZE,
  canDecryptEntry,
  createSectorDecryptor,
  decryptDk3,
  decryptEkpfs,
  type Ps4PkgKeys,
  decryptEntry,
} from "./ps4-pkg-crypto";
import {
  Ps4PkgError,
  readExactly,
  readPs4PkgInfoFromFd,
  type Ps4PkgInfo,
} from "./ps4-pkg-info";

const ENTRY_KEYS_ID = 0x10;
const IMAGE_KEY_ID = 0x20;
const FIRST_GAME_DATA_ENTRY_ID = 0x400;
const PFS_SEED_OFFSET = 0x370;
const PFSC_MAGIC = 0x43534650;
const PFSC_SCAN_START = 0x20000;
const PFSC_SCAN_STEP = 0x10000;
const PFS_MAGIC = 20130315n;
const MIN_PFSC_BLOCK_SIZE = 0x1000;
const MAX_PFSC_BLOCK_SIZE = 0x100000;
const PFS_MODE_SIGNED = 0x1;
const PFS_MODE_64BIT = 0x2;
const INODE_HEADER_SIZE = 0x64;
const DIRENT_HEADER_SIZE = 0x10;
const DIRENT_FILE = 2;
const FLAT_BLOCK_MARKER = -1;
const DIRENT_DIRECTORY = 3;

export interface Ps4PkgExtractProgress {
  /** Bytes written by this shard, out of the bytes this shard writes. */
  writtenBytes: number;
  totalBytes: number;
  /** Bytes of every file in the PKG. */
  pkgBytes: number;
}

export interface Ps4PkgExtractShard {
  index: number;
  count: number;
}

export interface Ps4PkgExtractOptions {
  pkgPath: string;
  outputDirectory: string;
  onProgress?: (progress: Ps4PkgExtractProgress) => void;
  keys: Ps4PkgKeys;
  /** Extracts only one share of the files, so several workers can split a PKG. */
  shard?: Ps4PkgExtractShard;
}

interface Inode {
  size: number;
  blocks: number;
  firstBlock: number;
  secondBlock: number;
}

interface PfsFile {
  relativePath: string;
  inode: Inode;
}

const isSafeName = (name: string) =>
  name !== "" &&
  name !== "." &&
  name !== ".." &&
  !name.includes("/") &&
  !name.includes("\\") &&
  !name.includes("\0");

class OuterImage {
  private readonly decryptSectors: (data: Buffer, sector: number) => Buffer;

  constructor(
    private readonly fd: number,
    private readonly info: Ps4PkgInfo,
    ekpfs: Buffer
  ) {
    const seed = readExactly(fd, info.pfsImageOffset + PFS_SEED_OFFSET, 16);
    this.decryptSectors = createSectorDecryptor(ekpfs, seed);
  }

  read(offset: number, length: number) {
    const start = offset - (offset % XTS_SECTOR_SIZE);
    const end =
      Math.ceil((offset + length) / XTS_SECTOR_SIZE) * XTS_SECTOR_SIZE;
    const plain = this.decryptSectors(
      readExactly(this.fd, this.info.pfsImageOffset + start, end - start),
      start / XTS_SECTOR_SIZE
    );
    return plain.subarray(offset - start, offset - start + length);
  }

  findPfsc() {
    const limit = this.info.pfsImageSize;
    for (
      let offset = PFSC_SCAN_START;
      offset < limit;
      offset += PFSC_SCAN_STEP
    ) {
      if (this.read(offset, 4).readUInt32LE(0) === PFSC_MAGIC) return offset;
    }
    throw new Ps4PkgError(
      "unsupported_pkg",
      "Could not find the game image in the PKG"
    );
  }
}

class InnerImage {
  private readonly blockSize: number;
  private readonly blockOffsets: number[];
  private cachedIndex = -1;
  private cachedBlock: Buffer = Buffer.alloc(0);

  constructor(
    private readonly outer: OuterImage,
    private readonly pfscOffset: number
  ) {
    const header = outer.read(pfscOffset, 0x30);
    this.blockSize = Number(header.readBigUInt64LE(0x10));
    if (
      this.blockSize < MIN_PFSC_BLOCK_SIZE ||
      this.blockSize > MAX_PFSC_BLOCK_SIZE
    ) {
      throw new Ps4PkgError("unsupported_pkg", "Unexpected PFS block size");
    }
    const tableOffset = Number(header.readBigUInt64LE(0x18));
    const dataLength = Number(header.readBigUInt64LE(0x28));
    const blockCount = Math.ceil(dataLength / this.blockSize);
    const table = outer.read(pfscOffset + tableOffset, (blockCount + 1) * 8);
    this.blockOffsets = Array.from({ length: blockCount + 1 }, (_, index) =>
      Number(table.readBigUInt64LE(index * 8))
    );
  }

  private block(index: number) {
    if (index === this.cachedIndex) return this.cachedBlock;

    const start = this.blockOffsets[index];
    const end = this.blockOffsets[index + 1];
    if (start === undefined || end === undefined) {
      throw new Ps4PkgError("unsupported_pkg", `Missing PFS block ${index}`);
    }

    if (end < start || end - start > this.blockSize) {
      throw new Ps4PkgError("unsupported_pkg", `Bad PFS block ${index}`);
    }
    const stored = this.outer.read(this.pfscOffset + start, end - start);
    let block: Buffer;
    if (stored.length === this.blockSize) block = stored;
    else if (stored.length === 0) block = Buffer.alloc(this.blockSize);
    else block = zlib.inflateSync(stored, { maxOutputLength: this.blockSize });
    // A short block would leave the rest of the output uninitialized.
    if (block.length !== this.blockSize) {
      throw new Ps4PkgError("unsupported_pkg", `Bad PFS block ${index}`);
    }

    this.cachedIndex = index;
    this.cachedBlock = block;
    return block;
  }

  read(offset: number, length: number) {
    const output = Buffer.allocUnsafe(length);
    let copied = 0;
    while (copied < length) {
      const position = offset + copied;
      const index = Math.floor(position / this.blockSize);
      const inBlock = position % this.blockSize;
      const count = Math.min(this.blockSize - inBlock, length - copied);
      this.block(index).copy(output, copied, inBlock, inBlock + count);
      copied += count;
    }
    return output;
  }
}

class PfsTree {
  private readonly blockSize: number;
  private readonly inodeSize: number;
  private readonly firstBlockOffset: number;
  private readonly pointerSize: number;
  private readonly pointerStride: number;
  private readonly inodesPerBlock: number;
  private readonly superrootInode: number;

  constructor(private readonly image: InnerImage) {
    const superblock = image.read(0, 0x50);
    if (superblock.readBigUInt64LE(0x08) !== PFS_MAGIC) {
      throw new Ps4PkgError("unsupported_pkg", "Unexpected PFS superblock");
    }

    const mode = superblock.readUInt16LE(0x1c);
    const isSigned = (mode & PFS_MODE_SIGNED) !== 0;
    const is64Bit = (mode & PFS_MODE_64BIT) !== 0;
    this.pointerSize = is64Bit ? 8 : 4;
    const digestSize = isSigned ? 32 : 0;
    this.firstBlockOffset = INODE_HEADER_SIZE + digestSize;
    this.pointerStride = digestSize + this.pointerSize;
    this.inodeSize = INODE_HEADER_SIZE + 17 * this.pointerStride;
    this.blockSize = superblock.readUInt32LE(0x20);
    this.inodesPerBlock = Math.floor(this.blockSize / this.inodeSize);
    this.superrootInode = Number(superblock.readBigUInt64LE(0x48));
  }

  private readPointer(raw: Buffer, offset: number) {
    const value =
      this.pointerSize === 8
        ? raw.readBigUInt64LE(offset)
        : BigInt(raw.readUInt32LE(offset));
    const allOnes = this.pointerSize === 8 ? 0xffffffffffffffffn : 0xffffffffn;
    return value === allOnes ? FLAT_BLOCK_MARKER : Number(value);
  }

  inode(number: number): Inode {
    const block = 1 + Math.floor(number / this.inodesPerBlock);
    const offset =
      block * this.blockSize + (number % this.inodesPerBlock) * this.inodeSize;
    const raw = this.image.read(offset, this.inodeSize);

    return {
      size: Number(raw.readBigUInt64LE(0x08)),
      blocks: raw.readUInt32LE(0x60),
      firstBlock: this.readPointer(raw, this.firstBlockOffset),
      secondBlock: this.readPointer(
        raw,
        this.firstBlockOffset + this.pointerStride
      ),
    };
  }

  private assertContiguous(inode: Inode) {
    if (
      inode.blocks > 1 &&
      inode.secondBlock !== 0 &&
      inode.secondBlock !== FLAT_BLOCK_MARKER &&
      inode.secondBlock !== inode.firstBlock + 1
    ) {
      throw new Ps4PkgError(
        "unsupported_pkg",
        "PKG has a fragmented file, which is not supported"
      );
    }
  }

  private entries(inode: Inode) {
    this.assertContiguous(inode);
    const data = this.image.read(
      inode.firstBlock * this.blockSize,
      inode.blocks * this.blockSize
    );
    const entries: { inode: number; type: number; name: string }[] = [];

    for (let block = 0; block < inode.blocks; block++) {
      const blockStart = block * this.blockSize;
      let offset = 0;
      while (offset + DIRENT_HEADER_SIZE <= this.blockSize) {
        const position = blockStart + offset;
        const inodeNumber = data.readUInt32LE(position);
        const type = data.readUInt32LE(position + 4);
        const nameLength = data.readUInt32LE(position + 8);
        const entrySize = data.readUInt32LE(position + 12);
        if (inodeNumber === 0 || entrySize === 0) break;

        entries.push({
          inode: inodeNumber,
          type,
          name: data.toString(
            "utf8",
            position + DIRENT_HEADER_SIZE,
            position + DIRENT_HEADER_SIZE + nameLength
          ),
        });
        offset += entrySize;
      }
    }

    return entries;
  }

  files(): { files: PfsFile[]; directories: string[] } {
    const uroot = this.entries(this.inode(this.superrootInode)).find(
      (entry) => entry.type === DIRENT_DIRECTORY && entry.name === "uroot"
    );
    if (!uroot) {
      throw new Ps4PkgError("unsupported_pkg", "PKG has no game root");
    }

    const files: PfsFile[] = [];
    const directoryPaths: string[] = [];
    const directories = [{ inode: uroot.inode, relativePath: "" }];
    const visited = new Set<number>();

    while (directories.length > 0) {
      const directory = directories.pop()!;
      if (visited.has(directory.inode)) continue;
      visited.add(directory.inode);

      for (const entry of this.entries(this.inode(directory.inode))) {
        if (entry.type !== DIRENT_FILE && entry.type !== DIRENT_DIRECTORY) {
          continue;
        }
        if (!isSafeName(entry.name)) {
          throw new Ps4PkgError(
            "unsupported_pkg",
            `PKG has an unsafe file name: ${entry.name}`
          );
        }

        const relativePath = path.join(directory.relativePath, entry.name);
        if (entry.type === DIRENT_DIRECTORY) {
          directories.push({ inode: entry.inode, relativePath });
          directoryPaths.push(relativePath);
        } else {
          files.push({ relativePath, inode: this.inode(entry.inode) });
        }
      }
    }

    return { files, directories: directoryPaths };
  }

  copyFile(file: PfsFile, target: string, onBytes: (count: number) => void) {
    this.assertContiguous(file.inode);
    const output = fs.openSync(target, "w");
    try {
      const start = file.inode.firstBlock * this.blockSize;
      for (let done = 0; done < file.inode.size; ) {
        const count = Math.min(this.blockSize, file.inode.size - done);
        fs.writeSync(output, this.image.read(start + done, count));
        done += count;
        onBytes(count);
      }
    } finally {
      fs.closeSync(output);
    }
  }
}

const writeSystemEntries = (
  fd: number,
  info: Ps4PkgInfo,
  dk3: Buffer,
  systemDirectory: string
) => {
  for (const entry of info.entries) {
    if (entry.id < FIRST_GAME_DATA_ENTRY_ID || !entry.name) continue;
    if (entry.isEncrypted && !canDecryptEntry(entry)) continue;
    if (!entry.name.split("/").every(isSafeName)) continue;

    const target = path.join(systemDirectory, entry.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    if (!entry.isEncrypted) {
      fs.writeFileSync(target, readExactly(fd, entry.offset, entry.size));
      continue;
    }

    const alignedSize = Math.ceil(entry.size / 16) * 16;
    const data = readExactly(fd, entry.offset, alignedSize);
    fs.writeFileSync(
      target,
      decryptEntry(entry, dk3, data).subarray(0, entry.size)
    );
  }
};

const requireEntry = (info: Ps4PkgInfo, id: number) => {
  const entry = info.entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Ps4PkgError("unsupported_pkg", `PKG has no entry ${id}`);
  }
  return entry;
};

export const listPs4PkgFiles = (
  fd: number,
  info: Ps4PkgInfo,
  keys: Ps4PkgKeys
) => {
  const entryKeys = requireEntry(info, ENTRY_KEYS_ID);
  const imageKey = requireEntry(info, IMAGE_KEY_ID);
  const dk3 = decryptDk3(
    readExactly(fd, entryKeys.offset, entryKeys.size),
    keys
  );
  const ekpfs = decryptEkpfs(
    imageKey,
    dk3,
    readExactly(fd, imageKey.offset, imageKey.size),
    keys
  );
  const outer = new OuterImage(fd, info, ekpfs);
  const tree = new PfsTree(new InnerImage(outer, outer.findPfsc()));
  return { dk3, tree, ...tree.files() };
};

/** Splits the files by size the same way in every worker. */
const pickShard = (files: PfsFile[], shard: Ps4PkgExtractShard) => {
  if (shard.count <= 1) return files;
  const loads = new Array<number>(shard.count).fill(0);
  const picked: PfsFile[] = [];
  const bySize = files
    .map((file, order) => ({ file, order }))
    .sort((a, b) => b.file.inode.size - a.file.inode.size || a.order - b.order);
  for (const { file } of bySize) {
    const lightest = loads.indexOf(Math.min(...loads));
    loads[lightest] += file.inode.size;
    if (lightest === shard.index) picked.push(file);
  }
  return picked;
};

export const extractPs4Pkg = ({
  pkgPath,
  outputDirectory,
  onProgress,
  keys,
  shard = { index: 0, count: 1 },
}: Ps4PkgExtractOptions) => {
  const fd = fs.openSync(pkgPath, "r");
  try {
    const info = readPs4PkgInfoFromFd(fd);
    if (info.isDeltaPatch) {
      throw new Ps4PkgError(
        "unsupported_pkg",
        "Delta patches are not supported"
      );
    }

    const { dk3, tree, files, directories } = listPs4PkgFiles(fd, info, keys);
    const pkgBytes = files.reduce((sum, file) => sum + file.inode.size, 0);
    const shardFiles = pickShard(files, shard);
    const totalBytes = shardFiles.reduce(
      (sum, file) => sum + file.inode.size,
      0
    );
    let writtenBytes = 0;
    onProgress?.({ writtenBytes, totalBytes, pkgBytes });

    fs.mkdirSync(outputDirectory, { recursive: true });
    if (shard.index === 0) {
      writeSystemEntries(fd, info, dk3, path.join(outputDirectory, "sce_sys"));
    }
    for (const directory of directories) {
      fs.mkdirSync(path.join(outputDirectory, directory), { recursive: true });
    }

    for (const file of shardFiles) {
      const target = path.join(outputDirectory, file.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      tree.copyFile(file, target, (count) => {
        writtenBytes += count;
        onProgress?.({ writtenBytes, totalBytes, pkgBytes });
      });
    }

    return { info, totalBytes, fileCount: shardFiles.length };
  } finally {
    fs.closeSync(fd);
  }
};
