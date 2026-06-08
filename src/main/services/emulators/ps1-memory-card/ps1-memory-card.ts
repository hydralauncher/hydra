import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";

import { extractSkuFromSaveFolder } from "../ps2-memory-card/extract-save-sku";
import {
  PS1_BLOCK_BYTES,
  PS1_DATA_BLOCKS,
  PS1_FILENAME_MAX,
  PS1_FILENAME_OFFSET,
  PS1_FRAME_BYTES,
  PS1_LINK_END,
  PS1_STATE,
} from "./types";
import type { Ps1CardInfo, Ps1Save, Ps1SaveContents } from "./types";

/*
 * PS1 memory card reader. Pure Node (`fs`/`Buffer`) — no Electron/`@main`
 * imports — so it stays usable from standalone tooling.
 *
 * On-disk layout (raw 128 KB image):
 *   block 0          = directory. Frame 0 starts with magic "MC". Frames 1..15
 *                      are 128-byte directory entries, one per data block.
 *   blocks 1..15     = save data (8 KB each); a save chains across blocks.
 *
 * Directory entry (128 bytes):
 *   0x00 u32  block-allocation state (0x51 first / 0x52 mid / 0x53 last in use)
 *   0x04 u32  filesize in bytes (first block only; multiple of 8192)
 *   0x08 u16  link to next block: value+1 = next block index, 0xFFFF = last
 *   0x0A 20   filename (ASCII, NUL-terminated) — the save identifier / serial
 *
 * Container formats wrap the raw 128 KB image behind a fixed header; we detect
 * the offset by locating the "MC" magic at the start of block 0.
 */

const MAGIC = "MC";
// Known wrapper header sizes: raw (.mcd/.mcr/.mc) = 0, .vgs = 64, .vmp = 128,
// DexDrive (.gme) = 3904. The raw image always begins with "MC".
const HEADER_OFFSET_CANDIDATES = [0, 64, 128, 3904];

export const findDataOffset = (
  buf: Buffer,
  fileSize: number
): number | null => {
  for (const off of HEADER_OFFSET_CANDIDATES) {
    if (off + PS1_BLOCK_BYTES > fileSize) continue;
    if (off + 2 > buf.length) continue;
    if (buf.toString("latin1", off, off + MAGIC.length) === MAGIC) return off;
  }
  return null;
};

const readFilename = (frame: Buffer): string => {
  const raw = frame.subarray(
    PS1_FILENAME_OFFSET,
    PS1_FILENAME_OFFSET + PS1_FILENAME_MAX
  );
  const nul = raw.indexOf(0);
  return raw
    .subarray(0, nul === -1 ? raw.length : nul)
    .toString("latin1")
    .trim();
};

class Ps1MemoryCard {
  private constructor(
    readonly filePath: string,
    private readonly fh: FileHandle,
    readonly dataOffset: number,
    /** Block 0 (the directory), already read. */
    private readonly directory: Buffer
  ) {}

  static async open(filePath: string): Promise<Ps1MemoryCard | null> {
    let fh: FileHandle | null = null;
    try {
      fh = await fs.open(filePath, "r");
      const stat = await fh.stat();
      if (stat.size < PS1_BLOCK_BYTES) {
        await fh.close();
        return null;
      }

      // Read enough to cover the largest wrapper header + the directory block.
      const probeLen = Math.min(
        stat.size,
        (HEADER_OFFSET_CANDIDATES.at(-1) ?? 0) + PS1_BLOCK_BYTES
      );
      const probe = Buffer.alloc(probeLen);
      await fh.read(probe, 0, probeLen, 0);

      const dataOffset = findDataOffset(probe, stat.size);
      if (dataOffset === null) {
        await fh.close();
        return null;
      }

      const directory = Buffer.alloc(PS1_BLOCK_BYTES);
      await fh.read(directory, 0, PS1_BLOCK_BYTES, dataOffset);
      return new Ps1MemoryCard(filePath, fh, dataOffset, directory);
    } catch {
      if (fh) await fh.close().catch(() => undefined);
      return null;
    }
  }

  async close(): Promise<void> {
    await this.fh.close().catch(() => undefined);
  }

  private frame(blockIndex: number): Buffer {
    const start = blockIndex * PS1_FRAME_BYTES;
    return this.directory.subarray(start, start + PS1_FRAME_BYTES);
  }

  // Follow the link field from a first block to collect every block index the
  // save occupies. Falls back to contiguous indices if the chain is corrupt.
  private blockChain(firstBlock: number, sizeBytes: number): number[] {
    const expected = Math.min(
      Math.max(Math.ceil(sizeBytes / PS1_BLOCK_BYTES), 1),
      PS1_DATA_BLOCKS
    );

    const chain: number[] = [firstBlock];
    const seen = new Set<number>([firstBlock]);
    let cur = firstBlock;
    for (let step = 0; step < PS1_DATA_BLOCKS; step += 1) {
      const link = this.frame(cur).readUInt16LE(0x08);
      if (link === PS1_LINK_END) break;
      const next = link + 1; // link is "next block index minus one"
      if (next < 1 || next > PS1_DATA_BLOCKS || seen.has(next)) break;
      chain.push(next);
      seen.add(next);
      cur = next;
    }

    if (chain.length !== expected) {
      // Corrupt/ambiguous link chain — assume the common contiguous layout.
      const contiguous: number[] = [];
      for (
        let b = firstBlock;
        b <= PS1_DATA_BLOCKS && contiguous.length < expected;
        b += 1
      ) {
        contiguous.push(b);
      }
      return contiguous;
    }
    return chain;
  }

  listSaves(): Ps1Save[] {
    const saves: Ps1Save[] = [];
    for (let block = 1; block <= PS1_DATA_BLOCKS; block += 1) {
      const frame = this.frame(block);
      const state = frame.readUInt32LE(0x00) & 0xff;
      if (state !== PS1_STATE.IN_USE_FIRST) continue; // only first blocks

      const sizeBytes = frame.readUInt32LE(0x04);
      const identifier = readFilename(frame);
      if (!identifier) continue;

      const blockCount = this.blockChain(block, sizeBytes).length;
      saves.push({
        identifier,
        sku: extractSkuFromSaveFolder(identifier),
        firstBlock: block,
        blockCount,
        sizeBytes,
      });
    }
    return saves;
  }

  private async readBlock(blockIndex: number): Promise<Buffer> {
    const buf = Buffer.alloc(PS1_BLOCK_BYTES);
    await this.fh.read(
      buf,
      0,
      PS1_BLOCK_BYTES,
      this.dataOffset + blockIndex * PS1_BLOCK_BYTES
    );
    return buf;
  }

  async readSaveContents(identifier: string): Promise<Ps1SaveContents | null> {
    for (let block = 1; block <= PS1_DATA_BLOCKS; block += 1) {
      const frame = this.frame(block);
      const state = frame.readUInt32LE(0x00) & 0xff;
      if (state !== PS1_STATE.IN_USE_FIRST) continue;
      if (readFilename(frame) !== identifier) continue;

      const sizeBytes = frame.readUInt32LE(0x04);
      const chain = this.blockChain(block, sizeBytes);
      const blocks: Buffer[] = [];
      for (const b of chain) blocks.push(await this.readBlock(b));

      return {
        identifier,
        headerFrame: Buffer.from(frame),
        blocks,
      };
    }
    return null;
  }
}

/**
 * Open a PS1 memory card image and list its game saves. Returns `null` if the
 * file is not a readable PS1 card (no "MC" magic, too small, read error).
 */
export const listPs1Saves = async (
  filePath: string
): Promise<Ps1CardInfo | null> => {
  const card = await Ps1MemoryCard.open(filePath);
  if (!card) return null;
  try {
    return { filePath, dataOffset: card.dataOffset, saves: card.listSaves() };
  } catch {
    return null;
  } finally {
    await card.close();
  }
};

/** Read one save's blocks (with bytes), for `.mcs` export. */
export const readPs1SaveContents = async (
  filePath: string,
  identifier: string
): Promise<Ps1SaveContents | null> => {
  const card = await Ps1MemoryCard.open(filePath);
  if (!card) return null;
  try {
    return await card.readSaveContents(identifier);
  } catch {
    return null;
  } finally {
    await card.close();
  }
};
