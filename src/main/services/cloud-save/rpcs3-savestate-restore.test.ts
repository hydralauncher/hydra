import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { resolveRpcs3SavestateRestoreRule } from "./rpcs3-savestate-restore.js";

describe("RPCS3 savestate restore", () => {
  const game = { discs: [{ sku: "BLUS30443" }] } as Game;
  const rawPath = "<emulator>/rpcs3-state/BLUS30443";

  it("targets only the selected game's savestate directory", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const file = { rawPath, relativePath: "BLUS30443_1_0.SAVESTAT.zst" };
      const rule = await resolveRpcs3SavestateRestoreRule(
        game,
        file,
        configRoot
      );
      assert.equal(
        rule?.preferredPath,
        path.join(configRoot, "savestates", "BLUS30443")
      );
      assert.equal(rule?.kind, "dir");
      assert.equal(
        await resolveRpcs3SavestateRestoreRule(
          game,
          { rawPath, relativePath: "BLES99999_1_0.SAVESTAT.zst" },
          configRoot
        ),
        null
      );
      assert.equal(
        await resolveRpcs3SavestateRestoreRule(
          game,
          { rawPath, relativePath: "../BLUS30443_1_0.SAVESTAT.zst" },
          configRoot
        ),
        null
      );
      assert.equal(
        await resolveRpcs3SavestateRestoreRule(
          game,
          {
            rawPath: "<emulator>/rpcs3-state/BLES99999",
            relativePath: file.relativePath,
          },
          configRoot
        ),
        null
      );
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked state directory or destination", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const outside = path.join(configRoot, "outside");
      const statesRoot = path.join(configRoot, "savestates");
      await fs.mkdir(outside);
      await fs.symlink(outside, statesRoot);
      const file = { rawPath, relativePath: "BLUS30443_1_0.SAVESTAT.zst" };
      assert.equal(
        await resolveRpcs3SavestateRestoreRule(game, file, configRoot),
        null
      );
      await fs.unlink(statesRoot);
      const titleRoot = path.join(statesRoot, "BLUS30443");
      await fs.mkdir(titleRoot, { recursive: true });
      await fs.symlink(
        path.join(configRoot, "outside", "state"),
        path.join(titleRoot, file.relativePath)
      );
      assert.equal(
        await resolveRpcs3SavestateRestoreRule(game, file, configRoot),
        null
      );
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });
});
