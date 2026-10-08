import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveRpcs3GamedataRestoreRule } from "./rpcs3-gamedata-restore.js";

describe("RPCS3 game data restore", () => {
  const rawPath = "<emulator>/rpcs3-gamedata/BCUS98245";
  const allowed = new Set(["BCUS98245"]);

  it("targets the game data directory for the selected title only", async () => {
    const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const rule = await resolveRpcs3GamedataRestoreRule(
        { rawPath, relativePath: "BCUS98245_USER1/USRDIR/bigfart2" },
        allowed,
        hdd0
      );
      assert.equal(rule?.preferredPath, path.join(hdd0, "game"));
      assert.equal(rule?.kind, "dir");
      assert.equal(rule?.rawPath, rawPath);

      for (const relativePath of [
        "../BCUS98245_USER1/USRDIR/bigfart2",
        "BCUS98245_USER1/../../outside",
        "BCUS98245_USER1",
        "BCUS98245/USRDIR/data.farc",
        "BCUS98245_INSTALL/USRDIR/install.bin",
        "BCES00850_USER1/USRDIR/bigfart2",
        "/BCUS98245_USER1/USRDIR/bigfart2",
        "BCUS98245_USER1\\USRDIR\\bigfart2",
      ]) {
        assert.equal(
          await resolveRpcs3GamedataRestoreRule(
            { rawPath, relativePath },
            allowed,
            hdd0
          ),
          null,
          relativePath
        );
      }
      assert.equal(
        await resolveRpcs3GamedataRestoreRule(
          {
            rawPath: "<emulator>/rpcs3-gamedata/BCES00850",
            relativePath: "BCES00850_USER1/USRDIR/bigfart2",
          },
          allowed,
          hdd0
        ),
        null
      );
      assert.equal(
        await resolveRpcs3GamedataRestoreRule(
          {
            rawPath: "<emulator>/rpcs3-gamedata/../BCUS98245",
            relativePath: "BCUS98245_USER1/USRDIR/bigfart2",
          },
          allowed,
          hdd0
        ),
        null
      );
    } finally {
      await fs.rm(hdd0, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked game data folder", async () => {
    const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const gameRoot = path.join(hdd0, "game");
      const outside = path.join(hdd0, "outside");
      await fs.mkdir(gameRoot, { recursive: true });
      await fs.mkdir(outside);
      await fs.symlink(
        outside,
        path.join(gameRoot, "BCUS98245_USER1"),
        "junction"
      );
      assert.equal(
        await resolveRpcs3GamedataRestoreRule(
          { rawPath, relativePath: "BCUS98245_USER1/USRDIR/bigfart2" },
          allowed,
          hdd0
        ),
        null
      );
    } finally {
      await fs
        .unlink(path.join(hdd0, "game", "BCUS98245_USER1"))
        .catch(() => {});
      await fs.rm(hdd0, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked game directory", async () => {
    const hdd0 = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const outside = path.join(hdd0, "outside");
      await fs.mkdir(outside);
      await fs.symlink(outside, path.join(hdd0, "game"), "junction");
      assert.equal(
        await resolveRpcs3GamedataRestoreRule(
          { rawPath, relativePath: "BCUS98245_USER1/USRDIR/bigfart2" },
          allowed,
          hdd0
        ),
        null
      );
    } finally {
      await fs.rm(hdd0, { recursive: true, force: true });
    }
  });
});
