import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import { extractTitleIdFromIso } from "./verified-ps3-iso-title-id.js";

const SECTOR = 2048;
const writeEntry = (
  image: Buffer,
  sector: number,
  name: string,
  targetSector: number,
  size: number,
  isDirectory: boolean
) => {
  const offset = sector * SECTOR;
  image[offset] = 33 + name.length;
  image.writeUInt32LE(targetSector, offset + 2);
  image.writeUInt32LE(size, offset + 10);
  image[offset + 25] = isDirectory ? 2 : 0;
  image[offset + 32] = name.length;
  image.write(name, offset + 33, "latin1");
};

it("reads TITLE_ID inside ISO metadata and ignores its filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-iso-"));
  try {
    const iso = path.join(root, "NPUB31419.iso");
    const image = Buffer.alloc(23 * SECTOR);
    const pvd = 16 * SECTOR;
    image[pvd] = 1;
    image.write("CD001", pvd + 1, "ascii");
    image.writeUInt32LE(20, pvd + 156 + 2);
    image.writeUInt32LE(SECTOR, pvd + 156 + 10);
    writeEntry(image, 20, "PS3_GAME", 21, SECTOR, true);
    writeEntry(image, 21, "PARAM.SFO", 22, 64, false);
    const sfo = 22 * SECTOR;
    image.writeUInt32LE(0x46535000, sfo);
    image.writeUInt32LE(36, sfo + 8);
    image.writeUInt32LE(48, sfo + 12);
    image.writeUInt32LE(1, sfo + 16);
    image.writeUInt32LE(10, sfo + 24);
    image.write("TITLE_ID", sfo + 36, "ascii");
    image.write("BLUS30443", sfo + 48, "ascii");
    await fs.writeFile(iso, image);
    assert.equal(await extractTitleIdFromIso(iso), "BLUS-30443");
    await fs.writeFile(iso, "BLUS30443");
    assert.equal(await extractTitleIdFromIso(iso), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
