import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveRpcs3SavedataRestoreRule } from "./rpcs3-savedata-restore.js";

describe("RPCS3 savedata restore", () => {
  const allowed = new Set(["BLUS30443"]);
  const relativePath = "BLUS30443-SLOT01/DATA.BIN";

  it("restores each save into the RPCS3 user it was recorded from", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      for (const profileId of ["00000001", "00000002", "00000007"]) {
        await fs.mkdir(path.join(homeRoot, profileId));
        const rule = await resolveRpcs3SavedataRestoreRule(
          { rawPath: `<emulator>/rpcs3/BLUS30443/${profileId}`, relativePath },
          allowed,
          homeRoot
        );
        assert.equal(
          rule?.preferredPath,
          path.join(homeRoot, profileId, "savedata")
        );
        assert.equal(rule?.kind, "dir");
      }
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("does not create a missing RPCS3 user", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      await fs.mkdir(path.join(homeRoot, "00000001"));
      assert.equal(
        await resolveRpcs3SavedataRestoreRule(
          { rawPath: "<emulator>/rpcs3/BLUS30443/00000003", relativePath },
          allowed,
          homeRoot
        ),
        null
      );
      assert.equal(existsSync(path.join(homeRoot, "00000003")), false);
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("rejects other titles, traversal and symlinked users", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    const link = path.join(homeRoot, "00000002");
    try {
      await fs.mkdir(path.join(homeRoot, "00000001"));
      await fs.symlink(outside, link, "junction");
      for (const file of [
        {
          rawPath: "<emulator>/rpcs3/BLES99999/00000001",
          relativePath: "BLES99999-SLOT01/DATA.BIN",
        },
        {
          rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
          relativePath: "BLES99999-SLOT01/DATA.BIN",
        },
        {
          rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
          relativePath: "../BLUS30443-SLOT01/DATA.BIN",
        },
        {
          rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
          relativePath: "BLUS30443-SLOT01",
        },
        {
          rawPath: "<emulator>/rpcs3/BLUS30443/../00000001",
          relativePath,
        },
        { rawPath: "<emulator>/rpcs3/BLUS30443/00000002", relativePath },
      ]) {
        assert.equal(
          await resolveRpcs3SavedataRestoreRule(file, allowed, homeRoot),
          null,
          JSON.stringify(file)
        );
      }
    } finally {
      await fs.unlink(link).catch(() => {});
      await fs.rm(homeRoot, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
