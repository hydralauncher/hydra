import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import { readVerifiedPs3DirectoryTitleId } from "./verified-ps3-directory-title-id.js";

it("reads PARAM.SFO for folders and EBOOT instead of guessing from names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-id-"));
  try {
    const gameRoot = path.join(root, "NPUB31419");
    const ps3Game = path.join(gameRoot, "PS3_GAME");
    const usrdir = path.join(ps3Game, "USRDIR");
    await fs.mkdir(usrdir, { recursive: true });
    const sfo = Buffer.alloc(64);
    sfo.writeUInt32LE(0x46535000, 0);
    sfo.writeUInt32LE(36, 8);
    sfo.writeUInt32LE(48, 12);
    sfo.writeUInt32LE(1, 16);
    sfo.writeUInt32LE(10, 24);
    sfo.write("TITLE_ID", 36, "ascii");
    sfo.write("BLUS30443", 48, "ascii");
    await fs.writeFile(path.join(ps3Game, "PARAM.SFO"), sfo);
    const eboot = path.join(usrdir, "EBOOT.BIN");
    await fs.writeFile(eboot, "boot");
    assert.equal(
      await readVerifiedPs3DirectoryTitleId(gameRoot, true),
      "BLUS-30443"
    );
    assert.equal(
      await readVerifiedPs3DirectoryTitleId(eboot, false),
      "BLUS-30443"
    );
    assert.equal(
      await readVerifiedPs3DirectoryTitleId(
        path.join(root, "NPUB31419"),
        false
      ),
      null
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
