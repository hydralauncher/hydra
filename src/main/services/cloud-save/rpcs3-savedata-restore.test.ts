import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ensureRpcs3RestoredUserNames,
  resolveRpcs3SavedataRestoreRule,
} from "./rpcs3-savedata-restore.js";

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

  it("restores into an RPCS3 user missing on this machine without creating it early", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      await fs.mkdir(path.join(homeRoot, "00000001"));
      const rule = await resolveRpcs3SavedataRestoreRule(
        { rawPath: "<emulator>/rpcs3/BLUS30443/00000003", relativePath },
        allowed,
        homeRoot
      );
      assert.equal(
        rule?.preferredPath,
        path.join(homeRoot, "00000003", "savedata")
      );
      assert.equal(existsSync(path.join(homeRoot, "00000003")), false);
      assert.equal(
        await resolveRpcs3SavedataRestoreRule(
          { rawPath: "<emulator>/rpcs3/BLUS30443/00000003", relativePath },
          allowed,
          path.join(homeRoot, "missing-home")
        ),
        null
      );
      await fs.writeFile(path.join(homeRoot, "00000004"), "not a user");
      assert.equal(
        await resolveRpcs3SavedataRestoreRule(
          { rawPath: "<emulator>/rpcs3/BLUS30443/00000004", relativePath },
          allowed,
          homeRoot
        ),
        null
      );
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("names restored RPCS3 users that have no local username", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      for (const profileId of ["00000001", "00000002"]) {
        await fs.mkdir(path.join(homeRoot, profileId, "savedata"), {
          recursive: true,
        });
      }
      await fs.writeFile(
        path.join(homeRoot, "00000001", "localusername"),
        "Existing"
      );
      const restored = (profileId: string) => ({
        rawPath: `<emulator>/rpcs3/BLUS30443/${profileId}`,
        restoreRootPath: path.join(homeRoot, profileId, "savedata"),
      });
      await ensureRpcs3RestoredUserNames([
        restored("00000001"),
        restored("00000002"),
        restored("00000002"),
        restored("00000012"),
        {
          rawPath: "<emulator>/rpcs3-gamedata/BLUS30443",
          restoreRootPath: path.join(homeRoot, "game"),
        },
      ]);
      assert.equal(
        await fs.readFile(
          path.join(homeRoot, "00000001", "localusername"),
          "utf8"
        ),
        "Existing"
      );
      assert.equal(
        await fs.readFile(
          path.join(homeRoot, "00000002", "localusername"),
          "utf8"
        ),
        "User 2"
      );
      assert.equal(existsSync(path.join(homeRoot, "00000012")), false);
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
