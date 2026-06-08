// Ported from libchdr (BSD-3-Clause) — copyright Aaron Giles, Romain Tisserand.
import { promises as fs } from "node:fs";
import zlib from "node:zlib";

import { logger } from "@main/services/logger";

const CD_FRAME_SIZE = 2448;
const CD_MAX_SECTOR_DATA = 2352;

const COMPRESSION_TYPE_0 = 0;
const COMPRESSION_TYPE_3 = 3;
const COMPRESSION_NONE = 4;
const COMPRESSION_SELF = 5;
const COMPRESSION_PARENT = 6;
const COMPRESSION_RLE_SMALL = 7;
const COMPRESSION_RLE_LARGE = 8;
const COMPRESSION_SELF_0 = 9;
const COMPRESSION_SELF_1 = 10;
const COMPRESSION_PARENT_SELF = 11;
const COMPRESSION_PARENT_0 = 12;
const COMPRESSION_PARENT_1 = 13;

const tag = (s: string): number =>
  (((s.codePointAt(0) ?? 0) << 24) |
    ((s.codePointAt(1) ?? 0) << 16) |
    ((s.codePointAt(2) ?? 0) << 8) |
    (s.codePointAt(3) ?? 0)) >>>
  0;

// Render a codec tag back to its FourCC (e.g. 0 -> "none", tag("cdfl") -> "cdfl")
// for diagnostic logging.
const untag = (n: number): string => {
  if (n === 0) return "none";
  const s = String.fromCodePoint(
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff
  );
  return s.replace(/[^\x20-\x7e]/g, "") || "?";
};

const CODEC_NONE = 0;
const CODEC_ZLIB = tag("zlib");
const CODEC_LZMA = tag("lzma");
const CODEC_ZSTD = tag("zstd");
const CODEC_CD_ZLIB = tag("cdzl");
const CODEC_CD_LZMA = tag("cdlz");
const CODEC_CD_ZSTD = tag("cdzs");

const CD_CODECS = new Set([CODEC_CD_ZLIB, CODEC_CD_LZMA, CODEC_CD_ZSTD]);

const beU32 = (b: Buffer, o: number) => b.readUInt32BE(o);
const beU48 = (b: Buffer, o: number) => b.readUIntBE(o, 6);

class Bitstream {
  private buffer = 0;
  private bits = 0;
  private doffset = 0;

  constructor(private readonly data: Buffer) {}

  private fill() {
    while (this.bits <= 24) {
      if (this.doffset < this.data.length) {
        this.buffer =
          (this.buffer | (this.data[this.doffset] << (24 - this.bits))) >>> 0;
      }
      this.doffset++;
      this.bits += 8;
    }
  }

  peek(numbits: number): number {
    if (numbits === 0) return 0;
    if (numbits > this.bits) this.fill();
    return this.buffer >>> (32 - numbits);
  }

  remove(numbits: number) {
    this.buffer = (this.buffer << numbits) >>> 0;
    this.bits -= numbits;
  }

  read(numbits: number): number {
    const r = this.peek(numbits);
    this.remove(numbits);
    return r;
  }

  overflow(): boolean {
    return this.doffset - Math.trunc(this.bits / 8) > this.data.length;
  }
}

const rleNumBits = (maxbits: number): number => {
  if (maxbits >= 16) return 5;
  if (maxbits >= 8) return 4;
  return 3;
};

class HuffmanDecoder {
  private readonly numbits: Uint8Array;
  private readonly codebits: Int32Array;
  private readonly lookup: Int32Array;

  constructor(
    private readonly numcodes: number,
    private readonly maxbits: number
  ) {
    this.numbits = new Uint8Array(numcodes);
    this.codebits = new Int32Array(numcodes);
    this.lookup = new Int32Array(1 << maxbits);
  }

  decodeOne(bits: Bitstream): number {
    const lookup = this.lookup[bits.peek(this.maxbits)];
    bits.remove(lookup & 0x1f);
    return lookup >>> 5;
  }

  importTreeRle(bits: Bitstream): boolean {
    const numbits = rleNumBits(this.maxbits);
    let curnode = 0;
    while (curnode < this.numcodes) {
      const nodebits = bits.read(numbits);
      if (nodebits !== 1) {
        this.numbits[curnode++] = nodebits;
        continue;
      }
      const repbits = bits.read(numbits);
      if (repbits === 1) {
        this.numbits[curnode++] = repbits;
        continue;
      }
      let repcount = bits.read(numbits) + 3;
      if (repcount + curnode > this.numcodes) return false;
      while (repcount--) this.numbits[curnode++] = repbits;
    }
    if (curnode !== this.numcodes) return false;
    return this.assignCanonicalCodes() && this.buildLookupTable();
  }

  private assignCanonicalCodes(): boolean {
    const bithisto = new Uint32Array(33);
    for (let c = 0; c < this.numcodes; c++) {
      const nb = this.numbits[c];
      if (nb > this.maxbits) return false;
      if (nb <= 32) bithisto[nb]++;
    }
    let curstart = 0;
    for (let codelen = 32; codelen > 0; codelen--) {
      const nextstart = (curstart + bithisto[codelen]) >>> 1;
      if (codelen !== 1 && nextstart * 2 !== curstart + bithisto[codelen]) {
        return false;
      }
      bithisto[codelen] = curstart;
      curstart = nextstart;
    }
    for (let c = 0; c < this.numcodes; c++) {
      if (this.numbits[c] > 0) this.codebits[c] = bithisto[this.numbits[c]]++;
    }
    return true;
  }

  private buildLookupTable(): boolean {
    const end = 1 << this.maxbits;
    for (let c = 0; c < this.numcodes; c++) {
      const nb = this.numbits[c];
      if (nb > 0) {
        const value = ((c << 5) | (nb & 0x1f)) >>> 0;
        const shift = this.maxbits - nb;
        const dest = this.codebits[c] << shift;
        const destend = ((this.codebits[c] + 1) << shift) - 1;
        if (dest >= end || destend >= end || destend < dest) return false;
        for (let i = dest; i <= destend; i++) this.lookup[i] = value;
      }
    }
    return true;
  }
}

const LZMA_LC = 3;
const LZMA_PB = 2;
const PROB_INIT = 1024;

const newProbs = (n: number): Uint16Array => {
  const a = new Uint16Array(n);
  a.fill(PROB_INIT);
  return a;
};

type Seq =
  | { kind: "continue" }
  | { kind: "break" }
  | { kind: "copy"; len: number };

const nextLiteralState = (state: number): number => {
  if (state < 4) return 0;
  if (state < 10) return state - 3;
  return state - 6;
};

function lzmaDecode(src: Buffer, outLen: number): Buffer {
  const out = Buffer.allocUnsafe(outLen);
  let outPos = 0;

  let inPos = 1;
  let code = 0;
  let range = 0xffffffff >>> 0;
  for (let i = 0; i < 4; i++)
    code = ((code << 8) | Math.trunc(src[inPos++])) >>> 0;

  const normalize = () => {
    if (range < 1 << 24) {
      range = (range << 8) >>> 0;
      code = ((code << 8) | Math.trunc(src[inPos++])) >>> 0;
    }
  };

  const decodeBit = (probs: Uint16Array, idx: number): number => {
    const v = probs[idx];
    const bound = ((range >>> 11) * v) >>> 0;
    let bit: number;
    if (code >>> 0 < bound) {
      range = bound >>> 0;
      probs[idx] = v + ((2048 - v) >>> 5);
      bit = 0;
    } else {
      code = (code - bound) >>> 0;
      range = (range - bound) >>> 0;
      probs[idx] = v - (v >>> 5);
      bit = 1;
    }
    normalize();
    return bit;
  };

  const decodeDirect = (numBits: number): number => {
    let res = 0;
    do {
      range = range >>> 1;
      code = (code - range) >>> 0;
      const t = (0 - (code >>> 31)) >>> 0;
      code = (code + (range & t)) >>> 0;
      normalize();
      res = ((res << 1) + (t + 1)) >>> 0;
    } while (--numBits);
    return res >>> 0;
  };

  const bitTree = (
    probs: Uint16Array,
    off: number,
    numBits: number
  ): number => {
    let m = 1;
    for (let i = 0; i < numBits; i++) m = (m << 1) + decodeBit(probs, off + m);
    return m - (1 << numBits);
  };

  const bitTreeReverse = (
    probs: Uint16Array,
    off: number,
    numBits: number
  ): number => {
    let m = 1;
    let sym = 0;
    for (let i = 0; i < numBits; i++) {
      const b = decodeBit(probs, off + m);
      m = (m << 1) + b;
      sym |= b << i;
    }
    return sym;
  };

  const isMatch = newProbs(12 << 4);
  const isRep = newProbs(12);
  const isRepG0 = newProbs(12);
  const isRepG1 = newProbs(12);
  const isRepG2 = newProbs(12);
  const isRep0Long = newProbs(12 << 4);
  const posSlot = newProbs(4 * 64);
  const specPos = newProbs(128);
  const align = newProbs(16);
  const literal = newProbs(0x300 << LZMA_LC);

  const mkLen = () => ({
    choice: newProbs(1),
    choice2: newProbs(1),
    low: newProbs(16 * 8),
    mid: newProbs(16 * 8),
    high: newProbs(256),
  });
  const lenDec = mkLen();
  const repLen = mkLen();
  const decodeLen = (L: ReturnType<typeof mkLen>, posState: number): number => {
    if (decodeBit(L.choice, 0) === 0) return bitTree(L.low, posState * 8, 3);
    if (decodeBit(L.choice2, 0) === 0)
      return 8 + bitTree(L.mid, posState * 8, 3);
    return 16 + bitTree(L.high, 0, 8);
  };

  let state = 0;
  let rep0 = 0;
  let rep1 = 0;
  let rep2 = 0;
  let rep3 = 0;
  const pbMask = (1 << LZMA_PB) - 1;

  const decodeLiteralSymbol = (): void => {
    const prevByte = outPos > 0 ? out[outPos - 1] : 0;
    const probsOff = 0x300 * (prevByte >> (8 - LZMA_LC));
    let symbol = 1;
    if (state >= 7) {
      let matchByte = out[outPos - rep0 - 1];
      do {
        const matchBit = (matchByte >> 7) & 1;
        matchByte = (matchByte << 1) & 0xff;
        const bit = decodeBit(
          literal,
          probsOff + ((1 + matchBit) << 8) + symbol
        );
        symbol = (symbol << 1) | bit;
        if (matchBit !== bit) break;
      } while (symbol < 0x100);
    }
    while (symbol < 0x100) {
      symbol = (symbol << 1) | decodeBit(literal, probsOff + symbol);
    }
    out[outPos++] = symbol & 0xff;
    state = nextLiteralState(state);
  };

  const decodeRepMatch = (posState: number): Seq => {
    if (decodeBit(isRepG0, state) === 0) {
      if (decodeBit(isRep0Long, (state << 4) + posState) === 0) {
        state = state < 7 ? 9 : 11;
        out[outPos] = out[outPos - rep0 - 1];
        outPos++;
        return { kind: "continue" };
      }
    } else {
      let dist: number;
      if (decodeBit(isRepG1, state) === 0) {
        dist = rep1;
      } else {
        if (decodeBit(isRepG2, state) === 0) {
          dist = rep2;
        } else {
          dist = rep3;
          rep3 = rep2;
        }
        rep2 = rep1;
      }
      rep1 = rep0;
      rep0 = dist;
    }
    const len = decodeLen(repLen, posState) + 2;
    state = state < 7 ? 8 : 11;
    return { kind: "copy", len };
  };

  const decodeNewMatch = (posState: number): Seq => {
    rep3 = rep2;
    rep2 = rep1;
    rep1 = rep0;
    let len = decodeLen(lenDec, posState);
    state = state < 7 ? 7 : 10;
    const lenToPos = len < 4 ? len : 3;
    const slot = bitTree(posSlot, lenToPos * 64, 6);
    if (slot < 4) {
      rep0 = slot;
    } else {
      const numDirect = (slot >> 1) - 1;
      rep0 = ((2 | (slot & 1)) << numDirect) >>> 0;
      if (slot < 14) {
        rep0 = (rep0 + bitTreeReverse(specPos, rep0 - slot, numDirect)) >>> 0;
      } else {
        rep0 = (rep0 + (decodeDirect(numDirect - 4) << 4)) >>> 0;
        rep0 = (rep0 + bitTreeReverse(align, 0, 4)) >>> 0;
      }
    }
    if (rep0 === 0xffffffff) return { kind: "break" };
    len += 2;
    return { kind: "copy", len };
  };

  while (outPos < outLen) {
    const posState = outPos & pbMask;
    if (decodeBit(isMatch, (state << 4) + posState) === 0) {
      decodeLiteralSymbol();
      continue;
    }

    const seq =
      decodeBit(isRep, state) === 0
        ? decodeNewMatch(posState)
        : decodeRepMatch(posState);
    if (seq.kind === "break") break;
    if (seq.kind === "continue") continue;

    for (let i = 0; i < seq.len && outPos < outLen; i++) {
      out[outPos] = out[outPos - rep0 - 1];
      outPos++;
    }
  }

  return out;
}

interface ChdHeader {
  version: number;
  compression: number[];
  logicalbytes: number;
  mapoffset: number;
  hunkbytes: number;
  hunkcount: number;
  compressed: boolean;
  isCd: boolean;
}

const readAt = async (
  fh: fs.FileHandle,
  pos: number,
  len: number
): Promise<Buffer> => {
  const buf = Buffer.allocUnsafe(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return bytesRead === len ? buf : buf.subarray(0, bytesRead);
};

const parseHeader = (raw: Buffer): ChdHeader | null => {
  if (raw.length < 124) return null;
  if (raw.toString("latin1", 0, 8) !== "MComprHD") return null;
  const version = beU32(raw, 12);
  if (version !== 5) return null;

  const compression = [
    beU32(raw, 16),
    beU32(raw, 20),
    beU32(raw, 24),
    beU32(raw, 28),
  ];
  const logicalbytes = Number(raw.readBigUInt64BE(32));
  const mapoffset = Number(raw.readBigUInt64BE(40));
  const hunkbytes = beU32(raw, 56);
  if (hunkbytes === 0) return null;
  const hunkcount = Math.ceil(logicalbytes / hunkbytes);
  const compressed = compression[0] !== CODEC_NONE;
  const isCd = compression.some((c) => CD_CODECS.has(c));

  return {
    version,
    compression,
    logicalbytes,
    mapoffset,
    hunkbytes,
    hunkcount,
    compressed,
    isCd,
  };
};

interface MapEntry {
  comp: number;
  length: number;
  offset: number;
}

const decodeCompList = (
  bits: Bitstream,
  decoder: HuffmanDecoder,
  hunkcount: number
): Uint8Array | null => {
  const comps = new Uint8Array(hunkcount);
  let lastcomp = 0;
  let repcount = 0;
  for (let h = 0; h < hunkcount; h++) {
    if (repcount > 0) {
      comps[h] = lastcomp;
      repcount--;
      continue;
    }
    if (bits.overflow()) return null;
    const val = decoder.decodeOne(bits);
    if (val === COMPRESSION_RLE_SMALL) {
      comps[h] = lastcomp;
      repcount = 2 + decoder.decodeOne(bits);
    } else if (val === COMPRESSION_RLE_LARGE) {
      comps[h] = lastcomp;
      repcount = 2 + 16 + (decoder.decodeOne(bits) << 4);
      repcount += decoder.decodeOne(bits);
    } else {
      comps[h] = lastcomp = val;
    }
  }
  return comps;
};

interface MapState {
  curoffset: number;
  lastSelf: number;
  lastParent: number;
}

const resolveMapEntry = (
  bits: Bitstream,
  comp: number,
  h: number,
  hunkbytes: number,
  meta: { lengthbits: number; selfbits: number; parentbits: number },
  st: MapState
): MapEntry => {
  const unitbytes = hunkbytes;
  let resolvedComp = comp;
  let offset = st.curoffset;
  let length = 0;
  switch (comp) {
    case COMPRESSION_TYPE_0:
    case COMPRESSION_TYPE_0 + 1:
    case COMPRESSION_TYPE_0 + 2:
    case COMPRESSION_TYPE_3:
      length = bits.read(meta.lengthbits);
      st.curoffset += length;
      bits.read(16);
      break;
    case COMPRESSION_NONE:
      length = hunkbytes;
      st.curoffset += length;
      bits.read(16);
      break;
    case COMPRESSION_SELF:
      st.lastSelf = offset = bits.read(meta.selfbits);
      break;
    case COMPRESSION_PARENT:
      offset = bits.read(meta.parentbits);
      st.lastParent = offset;
      break;
    case COMPRESSION_SELF_0:
    case COMPRESSION_SELF_1:
      if (comp === COMPRESSION_SELF_1) st.lastSelf++;
      resolvedComp = COMPRESSION_SELF;
      offset = st.lastSelf;
      break;
    case COMPRESSION_PARENT_SELF:
      resolvedComp = COMPRESSION_PARENT;
      st.lastParent = offset = Math.floor((h * hunkbytes) / unitbytes);
      break;
    case COMPRESSION_PARENT_0:
    case COMPRESSION_PARENT_1:
      if (comp === COMPRESSION_PARENT_1) {
        st.lastParent += Math.floor(hunkbytes / unitbytes);
      }
      resolvedComp = COMPRESSION_PARENT;
      offset = st.lastParent;
      break;
  }
  return { comp: resolvedComp, length, offset };
};

const decodeMap = async (
  fh: fs.FileHandle,
  header: ChdHeader
): Promise<MapEntry[] | null> => {
  const { hunkcount, hunkbytes, mapoffset } = header;

  if (!header.compressed) {
    const raw = await readAt(fh, mapoffset, hunkcount * 4);
    if (raw.length < hunkcount * 4) return null;
    const entries: MapEntry[] = new Array(hunkcount);
    for (let i = 0; i < hunkcount; i++) {
      entries[i] = {
        comp: COMPRESSION_NONE,
        length: hunkbytes,
        offset: beU32(raw, i * 4) * hunkbytes,
      };
    }
    return entries;
  }

  const mapHeader = await readAt(fh, mapoffset, 16);
  if (mapHeader.length < 16) return null;
  const mapbytes = beU32(mapHeader, 0);
  const firstoffs = beU48(mapHeader, 4);
  const lengthbits = mapHeader[12];
  const selfbits = mapHeader[13];
  const parentbits = mapHeader[14];

  const compressedMap = await readAt(fh, mapoffset + 16, mapbytes);
  if (compressedMap.length < mapbytes) return null;
  const bits = new Bitstream(compressedMap);

  const decoder = new HuffmanDecoder(16, 8);
  if (!decoder.importTreeRle(bits)) return null;

  const comps = decodeCompList(bits, decoder, hunkcount);
  if (!comps) return null;

  const entries: MapEntry[] = new Array(hunkcount);
  const st: MapState = { curoffset: firstoffs, lastSelf: 0, lastParent: 0 };
  const meta = { lengthbits, selfbits, parentbits };
  for (let h = 0; h < hunkcount; h++) {
    entries[h] = resolveMapEntry(bits, comps[h], h, hunkbytes, meta, st);
  }
  return entries;
};

const inflateRaw = (src: Buffer): Buffer => zlib.inflateRawSync(src);
const zstdDecode = (src: Buffer): Buffer =>
  (
    zlib as unknown as { zstdDecompressSync: (b: Buffer) => Buffer }
  ).zstdDecompressSync(src);

const decodeCdHunk = (
  src: Buffer,
  hunkbytes: number,
  baseDecompress: (input: Buffer, outLen: number) => Buffer
): Buffer => {
  const frames = Math.floor(hunkbytes / CD_FRAME_SIZE);
  const complenBytes = hunkbytes < 65536 ? 2 : 3;
  const eccBytes = (frames + 7) >> 3;
  const headerBytes = eccBytes + complenBytes;
  let complenBase = (src[eccBytes] << 8) | src[eccBytes + 1];
  if (complenBytes > 2) complenBase = (complenBase << 8) | src[eccBytes + 2];
  const baseInput = src.subarray(headerBytes, headerBytes + complenBase);
  return baseDecompress(baseInput, frames * CD_MAX_SECTOR_DATA);
};

const decodeHunk = async (
  fh: fs.FileHandle,
  header: ChdHeader,
  entries: MapEntry[],
  hunkIndex: number,
  depth = 0
): Promise<Buffer | null> => {
  if (depth > 8 || hunkIndex < 0 || hunkIndex >= entries.length) return null;
  const entry = entries[hunkIndex];
  const { hunkbytes, compression } = header;

  if (!header.compressed) {
    if (entry.offset === 0) return Buffer.alloc(hunkbytes);
    return readAt(fh, entry.offset, hunkbytes);
  }

  switch (entry.comp) {
    case COMPRESSION_NONE:
      return readAt(fh, entry.offset, entry.length);
    case COMPRESSION_SELF:
      return decodeHunk(fh, header, entries, entry.offset, depth + 1);
    case COMPRESSION_PARENT:
      return null;
    default:
      break;
  }

  if (entry.comp > COMPRESSION_TYPE_3) return null;
  const codec = compression[entry.comp];
  const compressed = await readAt(fh, entry.offset, entry.length);

  switch (codec) {
    case CODEC_ZLIB:
      return inflateRaw(compressed);
    case CODEC_LZMA:
      return lzmaDecode(compressed, hunkbytes);
    case CODEC_ZSTD:
      return zstdDecode(compressed);
    case CODEC_CD_ZLIB:
      return decodeCdHunk(compressed, hunkbytes, (input) => inflateRaw(input));
    case CODEC_CD_LZMA:
      return decodeCdHunk(compressed, hunkbytes, (input, outLen) =>
        lzmaDecode(input, outLen)
      );
    case CODEC_CD_ZSTD:
      return decodeCdHunk(compressed, hunkbytes, (input) => zstdDecode(input));
    default:
      return null;
  }
};

const CHD_SCAN_LIMIT = 16 * 1024 * 1024;
// Upper bound on hunks examined. A full CD is ~40k hunks, but the data track
// (with SYSTEM.CNF) sits at the start, so we never need to walk the whole disc.
const MAX_HUNKS_SCANNED = 24000;

export interface ChdScanResult {
  chunks: Buffer[];
}

export const readChdLeadingData = async (
  filePath: string
): Promise<ChdScanResult | null> => {
  let fh: fs.FileHandle | null = null;
  try {
    fh = await fs.open(filePath, "r");
    const headerRaw = await readAt(fh, 0, 124);
    const header = parseHeader(headerRaw);
    if (!header) {
      logger.log("[chd] unsupported header", {
        filePath,
        magic: headerRaw.toString("latin1", 0, 8),
        version: headerRaw.length >= 16 ? beU32(headerRaw, 12) : -1,
      });
      return null;
    }

    const entries = await decodeMap(fh, header);
    if (!entries) {
      logger.log("[chd] map decode failed", {
        filePath,
        version: header.version,
        codecs: header.compression.map(untag),
      });
      return null;
    }

    const chunks: Buffer[] = [];
    let decoded = 0;
    let skipped = 0;
    const maxHunks = Math.min(header.hunkcount, MAX_HUNKS_SCANNED);
    for (let h = 0; h < maxHunks && decoded < CHD_SCAN_LIMIT; h++) {
      let chunk: Buffer | null;
      try {
        chunk = await decodeHunk(fh, header, entries, h);
      } catch {
        skipped += 1;
        continue;
      }
      // A hunk we can't decode (e.g. a cdfl/FLAC audio hunk) must NOT abort the
      // scan — skip it and keep reading the data hunks, where the serial lives.
      if (!chunk) {
        skipped += 1;
        continue;
      }
      chunks.push(chunk);
      decoded += chunk.length;
    }

    logger.log("[chd] leading-data scan", {
      filePath,
      version: header.version,
      codecs: header.compression.map(untag),
      hunkcount: header.hunkcount,
      hunksDecoded: chunks.length,
      hunksSkipped: skipped,
      bytesDecoded: decoded,
    });

    return chunks.length > 0 ? { chunks } : null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
};
