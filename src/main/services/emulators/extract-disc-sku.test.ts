import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { deflateSync } from "node:zlib";

import { extractDolphinGameId } from "./dolphin-disc-reader.js";
import { sniffDiscImage } from "./sniff-disc-platform.js";

const DOLPHIN_BLOCK_SIZE = 0x8000;
const CISO_HEADER_SIZE = 0x8000;
const GCZ_HEADER_SIZE = 0x20;
const GCZ_MAGIC = 0xb10bc001;
const GCZ_UNCOMPRESSED_FLAG = 1n << 63n;
const GAMECUBE_MAGIC = 0xc2339f3d;
const WII_MAGIC = 0x5d1c9ea3;

const createDiscBlock = (
  gameId: string,
  platform: "gamecube" | "wii"
): Buffer => {
  const block = Buffer.alloc(DOLPHIN_BLOCK_SIZE);
  block.write(gameId, 0, "ascii");
  if (platform === "gamecube") {
    block.writeUInt32BE(GAMECUBE_MAGIC, 0x1c);
  } else {
    block.writeUInt32BE(WII_MAGIC, 0x18);
  }
  return block;
};

const createCiso = (discBlock: Buffer, firstBlockUsed = true): Buffer => {
  const header = Buffer.alloc(CISO_HEADER_SIZE);
  header.write("CISO", 0, "ascii");
  header.writeUInt32LE(DOLPHIN_BLOCK_SIZE, 0x04);
  header[0x08] = firstBlockUsed ? 1 : 0;
  return Buffer.concat([header, discBlock]);
};

const createGcz = (discBlock: Buffer, compressed: boolean): Buffer => {
  const payload = compressed ? deflateSync(discBlock) : discBlock;
  const header = Buffer.alloc(GCZ_HEADER_SIZE);
  header.writeUInt32LE(GCZ_MAGIC, 0);
  header.writeBigUInt64LE(BigInt(payload.length), 0x08);
  header.writeBigUInt64LE(BigInt(discBlock.length), 0x10);
  header.writeUInt32LE(discBlock.length, 0x18);
  header.writeUInt32LE(1, 0x1c);

  const pointer = Buffer.alloc(8);
  pointer.writeBigUInt64LE(compressed ? 0n : GCZ_UNCOMPRESSED_FLAG);
  const hash = Buffer.alloc(4);
  return Buffer.concat([header, pointer, hash, payload]);
};

describe("Dolphin identifier extraction", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-dolphin-id-"));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("extracts a verbatim block from Dolphin's sparse CISO format", async () => {
    const filePath = path.join(tempDir, "game.ciso");
    await fs.writeFile(filePath, createCiso(createDiscBlock("RMGE01", "wii")));

    assert.equal(await extractDolphinGameId(filePath), "RMGE01");
    assert.equal(await sniffDiscImage(filePath), "wii");
  });

  it("rejects a Dolphin CISO whose disc-header block is omitted", async () => {
    const filePath = path.join(tempDir, "missing-header.ciso");
    await fs.writeFile(
      filePath,
      createCiso(createDiscBlock("RMGE01", "wii"), false)
    );

    assert.equal(await extractDolphinGameId(filePath), null);
    assert.equal(await sniffDiscImage(filePath), "unknown");
  });

  it("extracts and classifies a compressed GCZ game", async () => {
    const filePath = path.join(tempDir, "game.gcz");
    await fs.writeFile(
      filePath,
      createGcz(createDiscBlock("GM8E01", "gamecube"), true)
    );

    assert.equal(await extractDolphinGameId(filePath), "GM8E01");
    assert.equal(await sniffDiscImage(filePath), "gamecube");
  });

  it("extracts an uncompressed GCZ block", async () => {
    const filePath = path.join(tempDir, "uncompressed.gcz");
    await fs.writeFile(
      filePath,
      createGcz(createDiscBlock("GZLE01", "gamecube"), false)
    );

    assert.equal(await extractDolphinGameId(filePath), "GZLE01");
  });

  it("rejects a truncated GCZ file", async () => {
    const filePath = path.join(tempDir, "truncated.gcz");
    await fs.writeFile(filePath, Buffer.alloc(GCZ_HEADER_SIZE - 1));

    assert.equal(await extractDolphinGameId(filePath), null);
    assert.equal(await sniffDiscImage(filePath), "unknown");
  });
});
