import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";

import { readVerifiedPs3PkgTitleId } from "./verified-ps3-pkg-title-id.js";

it("reads the PKG content ID and ignores an ID in its filename", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-pkg-"));
  try {
    const pkg = path.join(root, "BLUS30443.pkg");
    const header = Buffer.alloc(0x80);
    header.writeUInt32BE(0x7f504b47, 0);
    header.write("UP0001-NPUB31419_00-MINECRAFT", 0x30, "ascii");
    await fs.writeFile(pkg, header);
    assert.equal(await readVerifiedPs3PkgTitleId(pkg), "NPUB-31419");
    await fs.writeFile(pkg, "BLUS30443");
    assert.equal(await readVerifiedPs3PkgTitleId(pkg), null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
