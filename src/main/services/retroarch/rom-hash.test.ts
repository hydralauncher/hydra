import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { crc32, hashRomFile } from "./rom-hash.js";

const CHECK_INPUT = Buffer.from("123456789", "ascii");
const CHECK_CRC = "CBF43926";

const writeTemp = (name: string, data: Buffer): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "rom-hash-"));
  const filePath = path.join(dir, name);
  writeFileSync(filePath, data);
  return filePath;
};

describe("crc32", () => {
  it("matches the standard check value", () => {
    assert.equal(crc32(CHECK_INPUT), CHECK_CRC);
  });

  it("pads short results to eight hex digits", () => {
    const hash = crc32(Buffer.from([0x9b]));
    assert.equal(hash.length, 8);
  });
});

describe("hashRomFile", () => {
  it("strips the iNES header before hashing NES roms", async () => {
    const header = Buffer.alloc(16);
    header.set([0x4e, 0x45, 0x53, 0x1a]);
    const headered = writeTemp(
      "game.nes",
      Buffer.concat([header, CHECK_INPUT])
    );
    const headerless = writeTemp("game2.nes", CHECK_INPUT);

    assert.equal(await hashRomFile(headered, "nes"), CHECK_CRC);
    assert.equal(await hashRomFile(headerless, "nes"), CHECK_CRC);
  });

  it("normalizes byteswapped n64 roms to big endian", async () => {
    const z64 = Buffer.from([0x80, 0x37, 0x12, 0x40, 0x01, 0x02, 0x03, 0x04]);
    const v64 = Buffer.from([0x37, 0x80, 0x40, 0x12, 0x02, 0x01, 0x04, 0x03]);
    const n64 = Buffer.from([0x40, 0x12, 0x37, 0x80, 0x04, 0x03, 0x02, 0x01]);

    const expected = crc32(z64);
    assert.equal(await hashRomFile(writeTemp("a.z64", z64), "n64"), expected);
    assert.equal(await hashRomFile(writeTemp("b.v64", v64), "n64"), expected);
    assert.equal(await hashRomFile(writeTemp("c.n64", n64), "n64"), expected);
  });

  it("strips the 512 byte copier header from smc dumps", async () => {
    const body = Buffer.alloc(1024, 0xab);
    const copierHeader = Buffer.alloc(512, 0x00);
    const bare = writeTemp("game.sfc", body);
    const headered = writeTemp("game.smc", Buffer.concat([copierHeader, body]));

    assert.equal(
      await hashRomFile(headered, "snes"),
      await hashRomFile(bare, "snes")
    );
  });

  it("hashes gb and gba roms as raw bytes", async () => {
    const gb = writeTemp("game.gb", CHECK_INPUT);
    assert.equal(await hashRomFile(gb, "gb"), CHECK_CRC);
  });

  it("returns null for unreadable files", async () => {
    assert.equal(await hashRomFile("/nonexistent/rom.gba", "gba"), null);
  });
});
