/**
 * Type definitions for the PS1 memory card on-disk format.
 *
 * Pure types + flag constants only — no runtime dependencies — so the parser,
 * the `.mcs` writer and any standalone tooling stay alias-free.
 *
 * A PS1 card is a flat 128 KB image: 16 blocks of 8 KB, each block 64 frames of
 * 128 bytes. Block 0 is the directory; blocks 1..15 hold one save each (a save
 * may chain across several blocks). Unlike PS2 there is no FAT, no ECC, no
 * folders and no timestamps in the directory.
 */

export const PS1_FRAME_BYTES = 128;
export const PS1_BLOCK_BYTES = 8192; // 64 frames * 128
export const PS1_BLOCK_COUNT = 16; // block 0 = directory, 1..15 = data
export const PS1_DATA_BLOCKS = 15;
export const PS1_CARD_BYTES = PS1_BLOCK_BYTES * PS1_BLOCK_COUNT; // 131072
export const PS1_FILENAME_OFFSET = 0x0a;
export const PS1_FILENAME_MAX = 20;

/** Directory-frame block-allocation states (offset 0x00, u32 LE). */
export const PS1_STATE = {
  IN_USE_FIRST: 0x51,
  IN_USE_MIDDLE: 0x52,
  IN_USE_LAST: 0x53,
  FREE_FRESH: 0xa0,
  FREE_DELETED_FIRST: 0xa1,
  FREE_DELETED_MIDDLE: 0xa2,
  FREE_DELETED_LAST: 0xa3,
} as const;

export const PS1_FREE_BLOCK_MASK = 0xf0;
export const PS1_LINK_OFFSET = 0x08;
export const PS1_LINK_END = 0xffff; // value at PS1_LINK_OFFSET = last block of file

/** One game save on the card (metadata only — no block contents). */
export interface Ps1Save {
  /** On-card identifier, e.g. "BASCUS-94163DRAKAN". UI fallback when unmatched. */
  identifier: string;
  /** Normalized serial "SCUS-94163", or null if unrecognized. */
  sku: string | null;
  /** Directory block index of the first block (1..15). */
  firstBlock: number;
  /** Number of 8 KB blocks the save occupies. */
  blockCount: number;
  /** Save size in bytes (the directory's filesize field). */
  sizeBytes: number;
}

/** A save's full contents — the input to the `.mcs` writer. */
export interface Ps1SaveContents {
  identifier: string;
  /** The first block's 128-byte directory frame, copied verbatim into `.mcs`. */
  headerFrame: Buffer;
  /** The save's data blocks, each PS1_BLOCK_BYTES long, in chain order. */
  blocks: Buffer[];
}

export interface Ps1CardInfo {
  filePath: string;
  /** Byte offset of the raw card image within the file (header-format aware). */
  dataOffset: number;
  saves: Ps1Save[];
}
