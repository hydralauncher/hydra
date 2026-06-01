import { promises as fs } from "node:fs";

import {
  findDataOffset,
  listPs1Saves,
  readPs1SaveContents,
} from "./ps1-memory-card";
import {
  PS1_BLOCK_BYTES,
  PS1_DATA_BLOCKS,
  PS1_FILENAME_MAX,
  PS1_FILENAME_OFFSET,
  PS1_FRAME_BYTES,
  PS1_LINK_END,
  PS1_STATE,
} from "./types";

/*
 * PS1 memory card WRITER — imports a `.mcs` single save back into a `.mcd`/`.mcr`
 * image. PS1 cards are tiny (128 KB + optional wrapper header), so we load the
 * whole file, mutate it in memory, then write it back.
 *
 * A save occupies N data blocks (8 KB each). For each block there is a 128-byte
 * directory frame in block 0: first block state 0x51 (filesize + filename + link
 * to next), middle 0x52, last 0x53; the link field stores `nextBlock - 1`
 * (0xFFFF on the last block). Every touched frame's XOR checksum (byte 0x7F) is
 * recomputed. There is no ECC.
 */

const FREE_STATE = PS1_STATE.FREE_FRESH; // 0xA0

interface McsContents {
  identifier: string;
  headerFrame: Buffer; // 128 bytes
  blocks: Buffer[]; // each PS1_BLOCK_BYTES
}

const readFrameName = (frame: Buffer): string => {
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

/** Reverse of `buildMcsBuffer`: a 128-byte header frame + N 8 KB data blocks. */
export const parseMcsBuffer = (buf: Buffer): McsContents | null => {
  if (
    buf.length < PS1_FRAME_BYTES + PS1_BLOCK_BYTES ||
    (buf.length - PS1_FRAME_BYTES) % PS1_BLOCK_BYTES !== 0
  ) {
    return null;
  }
  const headerFrame = Buffer.from(buf.subarray(0, PS1_FRAME_BYTES));
  const identifier = readFrameName(headerFrame);
  if (!identifier) return null;

  const blocks: Buffer[] = [];
  for (let off = PS1_FRAME_BYTES; off < buf.length; off += PS1_BLOCK_BYTES) {
    blocks.push(Buffer.from(buf.subarray(off, off + PS1_BLOCK_BYTES)));
  }
  return { identifier, headerFrame, blocks };
};

const frameOffset = (block: number): number => block * PS1_FRAME_BYTES;

const blockState = (directory: Buffer, block: number): number =>
  directory.readUInt32LE(frameOffset(block)) & 0xff;

const isFreeState = (state: number): boolean => (state & 0xf0) === 0xa0;

// XOR of bytes 0x00..0x7E, stored at 0x7F.
const writeFrameChecksum = (directory: Buffer, block: number): void => {
  const base = frameOffset(block);
  let xor = 0;
  for (let i = 0; i < PS1_FRAME_BYTES - 1; i += 1) xor ^= directory[base + i];
  directory[base + PS1_FRAME_BYTES - 1] = xor;
};

const freeFrame = (directory: Buffer, block: number): void => {
  const base = frameOffset(block);
  directory.fill(0, base, base + PS1_FRAME_BYTES);
  directory.writeUInt32LE(FREE_STATE, base);
  writeFrameChecksum(directory, block);
};

// Walk the link chain from a first block (link value + 1 = next block).
const chainFrom = (directory: Buffer, firstBlock: number): number[] => {
  const chain: number[] = [firstBlock];
  const seen = new Set<number>([firstBlock]);
  let cur = firstBlock;
  for (let step = 0; step < PS1_DATA_BLOCKS; step += 1) {
    const link = directory.readUInt16LE(frameOffset(cur) + 0x08);
    if (link === PS1_LINK_END) break;
    const next = link + 1;
    if (next < 1 || next > PS1_DATA_BLOCKS || seen.has(next)) break;
    chain.push(next);
    seen.add(next);
    cur = next;
  }
  return chain;
};

export interface Ps1ImportResult {
  ok: boolean;
  error?: string;
  identifier?: string;
}

/**
 * Import a `.mcs` save into a PS1 card, replacing a same-identifier save. Backs
 * the card up to `<card>.hydra-bak` first, restores it on any failure, and
 * verifies the result by re-reading the save before returning success.
 */
export const importMcsIntoCard = async (
  cardFilePath: string,
  mcsBuffer: Buffer
): Promise<Ps1ImportResult> => {
  const mcs = parseMcsBuffer(mcsBuffer);
  if (!mcs) return { ok: false, error: "Invalid .mcs data" };

  const backupPath = `${cardFilePath}.hydra-bak`;
  try {
    await fs.copyFile(cardFilePath, backupPath);
  } catch (err) {
    return {
      ok: false,
      error: `Could not back up card: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const restore = async (): Promise<void> => {
    await fs.copyFile(backupPath, cardFilePath).catch(() => undefined);
    await fs.rm(backupPath, { force: true }).catch(() => undefined);
  };

  try {
    const fileBuf = await fs.readFile(cardFilePath);
    const dataOffset = findDataOffset(fileBuf, fileBuf.length);
    if (dataOffset === null) {
      await restore();
      return { ok: false, error: "Not a writable PS1 memory card" };
    }
    const card = fileBuf.subarray(dataOffset);
    const directory = card; // block 0 holds every directory frame

    // Replace: free any existing save with the same identifier.
    for (let block = 1; block <= PS1_DATA_BLOCKS; block += 1) {
      if (blockState(directory, block) !== PS1_STATE.IN_USE_FIRST) continue;
      if (
        readFrameName(directory.subarray(frameOffset(block))) !== mcs.identifier
      ) {
        continue;
      }
      for (const b of chainFrom(directory, block)) freeFrame(directory, b);
    }

    // Find N free blocks (need not be contiguous).
    const need = mcs.blocks.length;
    const freeBlocks: number[] = [];
    for (
      let block = 1;
      block <= PS1_DATA_BLOCKS && freeBlocks.length < need;
      block += 1
    ) {
      if (isFreeState(blockState(directory, block))) freeBlocks.push(block);
    }
    if (freeBlocks.length < need) {
      await restore();
      return { ok: false, error: "Not enough free blocks on the memory card" };
    }

    // Write the chain's directory frames + data blocks.
    for (let i = 0; i < need; i += 1) {
      const block = freeBlocks[i];
      const base = frameOffset(block);
      directory.fill(0, base, base + PS1_FRAME_BYTES);

      if (i === 0) {
        // First block: keep the header frame's filesize + filename, set state +
        // link for the new chain.
        mcs.headerFrame.copy(directory, base, 0, PS1_FRAME_BYTES);
        directory.writeUInt32LE(PS1_STATE.IN_USE_FIRST, base);
      } else {
        const state =
          i === need - 1 ? PS1_STATE.IN_USE_LAST : PS1_STATE.IN_USE_MIDDLE;
        directory.writeUInt32LE(state, base);
      }
      const link = i === need - 1 ? PS1_LINK_END : freeBlocks[i + 1] - 1;
      directory.writeUInt16LE(link, base + 0x08);
      writeFrameChecksum(directory, block);

      mcs.blocks[i].copy(card, block * PS1_BLOCK_BYTES);
    }

    await fs.writeFile(cardFilePath, fileBuf);
  } catch (err) {
    await restore();
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Verify: the save reads back with matching block bytes.
  const info = await listPs1Saves(cardFilePath);
  const present = info?.saves.some((s) => s.identifier === mcs.identifier);
  let ok = present === true;
  if (ok) {
    const contents = await readPs1SaveContents(cardFilePath, mcs.identifier);
    ok = Boolean(
      contents &&
        contents.blocks.length === mcs.blocks.length &&
        mcs.blocks.every((b, i) => b.equals(contents.blocks[i]))
    );
  }

  if (!ok) {
    await restore();
    return { ok: false, error: "Import verification failed" };
  }

  await fs.rm(backupPath, { force: true }).catch(() => undefined);
  return { ok: true, identifier: mcs.identifier };
};
