import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  copyRetroArchFileVerified,
  moveRetroArchFileVerified,
} from "./retroarch-safe-move.js";

describe("RetroArch save materialization", () => {
  it("keeps the source intact if the destination contains different data", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-move-"));
    try {
      const source = path.join(root, "Mario_USA.state1");
      const target = path.join(root, "Mario_EUROPE.state1");
      await fs.writeFile(source, "original state");
      await fs.writeFile(target, "different state");
      await assert.rejects(
        moveRetroArchFileVerified(source, target),
        /cloud_save_retroarch_target_occupied/
      );
      assert.equal(await fs.readFile(source, "utf8"), "original state");
      assert.equal(await fs.readFile(target, "utf8"), "different state");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retries a completed copy and removes source only after verification", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "retroarch-move-"));
    try {
      const source = path.join(root, "Mario_USA.state1");
      const target = path.join(root, "states", "Mario_EUROPE.state4");
      await fs.writeFile(source, "saved state");
      await copyRetroArchFileVerified(source, target);
      assert.equal(await fs.readFile(source, "utf8"), "saved state");
      await moveRetroArchFileVerified(source, target);
      await assert.rejects(fs.lstat(source), { code: "ENOENT" });
      assert.equal(await fs.readFile(target, "utf8"), "saved state");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
