/**
 * PS2 memory card ECC — a port of the public-domain `ps2mc_ecc.py` (mymc, by
 * Ross Ridge). Pure (no I/O), so it stays usable from the verification script.
 *
 * Each 512-byte page on an ECC card carries a 16-byte spare: a 20-bit Hamming
 * code (3 bytes) per 128-byte chunk — four chunks per page = 12 bytes — followed
 * by 4 zero bytes. The code lets a reader detect and correct any single-bit
 * error within a chunk. We only ever recompute it on write.
 */

const parityb = (a: number): number => {
  a = a ^ (a >> 1);
  a = a ^ (a >> 2);
  a = a ^ (a >> 4);
  return a & 1;
};

const CP_MASKS = [0x55, 0x33, 0x0f, 0x00, 0xaa, 0xcc, 0xf0];

const PARITY_TABLE = new Uint8Array(256);
const COLUMN_PARITY_MASKS = new Uint8Array(256);
for (let b = 0; b < 256; b += 1) PARITY_TABLE[b] = parityb(b);
for (let b = 0; b < 256; b += 1) {
  let mask = 0;
  for (let i = 0; i < CP_MASKS.length; i += 1) {
    mask |= PARITY_TABLE[b & CP_MASKS[i]] << i;
  }
  COLUMN_PARITY_MASKS[b] = mask;
}

/** ECC (3 bytes) for one 128-byte chunk. */
const eccCalculateChunk = (
  buf: Buffer,
  offset: number,
  length: number
): [number, number, number] => {
  let columnParity = 0x77;
  let lineParity0 = 0x7f;
  let lineParity1 = 0x7f;
  for (let i = 0; i < length; i += 1) {
    const b = buf[offset + i];
    columnParity ^= COLUMN_PARITY_MASKS[b];
    if (PARITY_TABLE[b]) {
      lineParity0 ^= ~i;
      lineParity1 ^= i;
    }
  }
  return [columnParity & 0xff, lineParity0 & 0x7f, lineParity1 & 0xff];
};

/**
 * Build the `spareSize`-byte spare for one page: 3 ECC bytes per 128-byte chunk,
 * contiguous, zero-padded to the spare length. `spareSize` is
 * `(pageLen / 128) * 4` (16 for a 512-byte page).
 */
export const computePageSpare = (page: Buffer, spareSize: number): Buffer => {
  const spare = Buffer.alloc(spareSize); // zero-filled padding tail
  let o = 0;
  for (let chunk = 0; chunk + 128 <= page.length; chunk += 128) {
    const [c, l0, l1] = eccCalculateChunk(page, chunk, 128);
    spare[o] = c;
    spare[o + 1] = l0;
    spare[o + 2] = l1;
    o += 3;
  }
  return spare;
};
