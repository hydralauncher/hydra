import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sniffDiscImage } from "./sniff-disc-platform.js";

describe("sniffDiscImage Dolphin formats", () => {
  let tempDir: string;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-dolphin-sniff-"));
  });

  after(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("recognizes a GameCube disc header", async () => {
    const image = Buffer.alloc(0x100);
    image.write("GM8E01", 0, "ascii");
    image.writeUInt32BE(0xc2339f3d, 0x1c);
    const filePath = path.join(tempDir, "game.gcm");
    await fs.writeFile(filePath, image);

    assert.equal(await sniffDiscImage(filePath), "gamecube");
  });

  it("recognizes a Wii disc header", async () => {
    const image = Buffer.alloc(0x100);
    image.write("RMGE01", 0, "ascii");
    image.writeUInt32BE(0x5d1c9ea3, 0x18);
    const filePath = path.join(tempDir, "game.iso");
    await fs.writeFile(filePath, image);

    assert.equal(await sniffDiscImage(filePath), "wii");
  });

  it("recognizes a compressed Dolphin header at offset 0x58", async () => {
    const image = Buffer.alloc(0x100);
    image.write("GZLE01", 0x58, "ascii");
    image.writeUInt32BE(0xc2339f3d, 0x58 + 0x1c);
    const filePath = path.join(tempDir, "game.rvz");
    await fs.writeFile(filePath, image);

    assert.equal(await sniffDiscImage(filePath), "gamecube");
  });
});
