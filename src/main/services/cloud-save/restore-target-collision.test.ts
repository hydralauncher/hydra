import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { ResolveRestoreTargetsResult } from "@types";

import { blockAmbiguousRestoreTargets } from "./restore-target-collision.js";

const restorePlan = (
  root: string,
  targetNames: string[]
): ResolveRestoreTargetsResult => ({
  actions: targetNames.map((name, index) => ({
    variantId: "a".repeat(64),
    rawPath: index === 0 ? "<emulator>/retroarch" : "<custom>/save",
    relativePath: name,
    hash: "b".repeat(64),
    sizeBytes: 10,
    lastModifiedAt: "2026-09-29T00:00:00.000Z",
    targetPath: path.join(root, name),
    restoreRootPath: root,
    action: "create" as const,
  })),
  blocked: [],
  deferred: [],
});

describe("combined restore target collisions", () => {
  it("blocks emulator and custom saves aimed at one case-insensitive file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-restore-"));
    try {
      const plan = restorePlan(root, ["Mario.srm", "mario.srm"]);
      const macOrWindows = blockAmbiguousRestoreTargets(plan, false);
      assert.equal(macOrWindows.actions.length, 0);
      assert.deepEqual(
        macOrWindows.blocked.map((file) => file.reason),
        ["blocked-target-ambiguous", "blocked-target-ambiguous"]
      );
      assert.equal(plan.actions.length, 2);

      const linux = blockAmbiguousRestoreTargets(plan, true);
      assert.equal(linux.actions.length, 2);
      assert.equal(linux.blocked.length, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it(
    "compares canonical ancestors and leaves distinct targets available",
    { skip: process.platform === "win32" },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-restore-"));
      try {
        await fs.mkdir(path.join(root, "real"));
        await fs.symlink(path.join(root, "real"), path.join(root, "alias"));
        const plan = restorePlan(root, ["real/Mario.srm", "alias/Mario.srm"]);
        plan.actions.push({
          ...plan.actions[0]!,
          rawPath: "<emulator>/rpcs3",
          relativePath: "unrelated.srm",
          targetPath: path.join(root, "real", "unrelated.srm"),
        });

        const result = blockAmbiguousRestoreTargets(plan, true);
        assert.deepEqual(
          result.actions.map((action) => action.relativePath),
          ["unrelated.srm"]
        );
        assert.equal(result.blocked.length, 2);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  );
});
