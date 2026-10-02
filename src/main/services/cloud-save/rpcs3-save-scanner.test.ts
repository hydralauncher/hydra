import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  scanRpcs3SaveRoot,
  scanRpcs3Savestates,
} from "./rpcs3-save-scanner.js";

describe("RPCS3 Cloud Save scanner", () => {
  const game = {
    discs: [{ sku: "BLUS30443" }],
  } as Game;

  it("does not scan unrelated saves without a registered disc", async () => {
    const noDiscGame = { discs: [] } as unknown as Game;
    const context = {
      game: noDiscGame,
      environmentId: "environment",
      variantId: "variant",
      rpcs3SavedataTitleIds: ["NPUB31848"],
    };
    const savedata = await scanRpcs3SaveRoot(context, "/unused", "00000001");
    const states = await scanRpcs3Savestates(context, "/unused");

    for (const result of [savedata, states]) {
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "unresolved");
      assert.deepEqual(result.coverage[0].warningCodes, [
        "rpcs3-title-id-unresolved",
      ]);
    }
  });

  it("captures only the active profile and marks unsafe matching slots partial", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      for (const profileId of ["00000001", "00000002"]) {
        const slot = path.join(
          homeRoot,
          profileId,
          "savedata",
          "BLUS30443-SLOT01"
        );
        await fs.mkdir(slot, { recursive: true });
        await fs.writeFile(path.join(slot, "DATA.BIN"), profileId);
      }
      await fs.writeFile(
        path.join(homeRoot, "00000002", "savedata", "BLUS30443-BROKEN"),
        "not a directory"
      );
      const result = await scanRpcs3SaveRoot(
        { game, environmentId: "environment", variantId: "variant" },
        homeRoot,
        "00000002",
        "00000001"
      );

      assert.deepEqual(
        result.files.map((file) => [file.rawPath, file.relativePath]),
        [["<emulator>/rpcs3/BLUS30443/00000001", "BLUS30443-SLOT01/DATA.BIN"]]
      );
      assert.equal(
        result.files[0].localBindings.concreteUserSegment,
        "00000002"
      );
      assert.equal(result.coverage.length, 1);
      assert.equal(result.coverage[0].outcome, "partial");
      assert.equal(result.coverage[0].enumeratedCompletely, false);
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("does not treat a missing active profile as an empty save", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const result = await scanRpcs3SaveRoot(
        { game, environmentId: "environment", variantId: "variant" },
        homeRoot,
        "00000002"
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "unresolved");
      assert.deepEqual(result.coverage[0].warningCodes, [
        "rpcs3-active-profile-missing",
      ]);
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });

  it("captures only states for the game's Title ID and all RPCS3 formats", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const states = path.join(configRoot, "savestates", "BLUS30443");
      await fs.mkdir(states, { recursive: true });
      for (const name of [
        "BLUS30443_1_0.SAVESTAT",
        "BLUS30443_1_1.SAVESTAT.zst",
        "BLUS30443_1_2.SAVESTAT.gz",
        "BLES99999_1_3.SAVESTAT.zst",
      ]) {
        await fs.writeFile(path.join(states, name), Buffer.alloc(1025));
      }
      const result = await scanRpcs3Savestates(
        { game, environmentId: "environment", variantId: "variant" },
        configRoot
      );
      assert.deepEqual(
        result.files.map((file) => [file.rawPath, file.relativePath]).sort(),
        [
          ["<emulator>/rpcs3-state/BLUS30443", "BLUS30443_1_0.SAVESTAT"],
          ["<emulator>/rpcs3-state/BLUS30443", "BLUS30443_1_1.SAVESTAT.zst"],
          ["<emulator>/rpcs3-state/BLUS30443", "BLUS30443_1_2.SAVESTAT.gz"],
        ]
      );
      assert.equal(result.coverage[0].outcome, "scanned");
      assert.equal(
        result.files[0].localBindings.concreteUserSegment,
        "__default__"
      );
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("records absent savestate roots as confirmed missing", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const context = {
        game,
        environmentId: "environment",
        variantId: "variant",
      };
      const absentRoot = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(absentRoot.files, []);
      assert.equal(absentRoot.coverage[0].outcome, "confirmed-missing");
      assert.equal(absentRoot.coverage[0].selectedRoot, false);
      assert.equal(absentRoot.coverage[0].enumeratedCompletely, true);
      assert.deepEqual(absentRoot.coverage[0].warningCodes, []);

      await fs.mkdir(path.join(configRoot, "savestates"));
      const absentTitle = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(absentTitle.files, []);
      assert.equal(absentTitle.coverage[0].outcome, "confirmed-missing");
      assert.equal(absentTitle.coverage[0].selectedRoot, false);
      assert.equal(absentTitle.coverage[0].enumeratedCompletely, true);
      assert.deepEqual(absentTitle.coverage[0].warningCodes, []);
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("marks unknown matching states partial", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const context = {
        game,
        environmentId: "environment",
        variantId: "variant",
      };
      const states = path.join(configRoot, "savestates", "BLUS30443");
      await fs.mkdir(states, { recursive: true });
      await fs.writeFile(path.join(states, "BLUS30443_old.SAVESTAT"), "old");
      const partial = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(partial.files, []);
      assert.equal(partial.coverage[0].outcome, "partial");
      await fs.writeFile(
        path.join(states, "BLUS30443_1_1.SAVESTAT.zst"),
        "short"
      );
      const incomplete = await scanRpcs3Savestates(context, configRoot);
      assert.deepEqual(incomplete.files, []);
      assert.equal(incomplete.coverage[0].outcome, "partial");
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("keeps invalid and symlinked state roots partial", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    const context = {
      game,
      environmentId: "environment",
      variantId: "variant",
    };
    try {
      const statesRoot = path.join(configRoot, "savestates");
      await fs.writeFile(statesRoot, "not a directory");
      assert.equal(
        (await scanRpcs3Savestates(context, configRoot)).coverage[0].outcome,
        "partial"
      );

      await fs.unlink(statesRoot);
      await fs.mkdir(path.join(configRoot, "outside"));
      await fs.symlink(path.join(configRoot, "outside"), statesRoot);
      assert.equal(
        (await scanRpcs3Savestates(context, configRoot)).coverage[0].outcome,
        "partial"
      );

      await fs.unlink(statesRoot);
      await fs.mkdir(statesRoot);
      await fs.symlink(
        path.join(configRoot, "outside"),
        path.join(statesRoot, "BLUS30443")
      );
      assert.equal(
        (await scanRpcs3Savestates(context, configRoot)).coverage[0].outcome,
        "partial"
      );
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("scans Minecraft savedata while its savestate folder is absent", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    const minecraft = { discs: [{ sku: "NPUB31419" }] } as Game;
    const context = {
      game: minecraft,
      environmentId: "environment",
      variantId: "variant",
    };
    try {
      const homeRoot = path.join(configRoot, "dev_hdd0", "home");
      const saveRoot = path.join(homeRoot, "00000001", "savedata");
      for (const [slot, count] of [
        ["NPUB31419--260930163517", 5],
        ["NPUB31419-OPTIONS", 4],
      ] as const) {
        const slotRoot = path.join(saveRoot, slot);
        await fs.mkdir(slotRoot, { recursive: true });
        for (let index = 0; index < count; index++) {
          await fs.writeFile(path.join(slotRoot, `FILE${index}`), "save");
        }
      }
      await fs.mkdir(path.join(configRoot, "savestates"));

      const [savedata, savestates] = await Promise.all([
        scanRpcs3SaveRoot(context, homeRoot, "00000001"),
        scanRpcs3Savestates(context, configRoot),
      ]);
      assert.equal(savedata.files.length, 9);
      assert.equal(savedata.coverage[0].outcome, "scanned");
      assert.deepEqual(savestates.files, []);
      assert.equal(savestates.coverage[0].outcome, "confirmed-missing");
      assert.deepEqual(savestates.coverage[0].warningCodes, []);
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("does not treat an unknown state compression format as deletion", async () => {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      const states = path.join(configRoot, "savestates", "BLUS30443");
      await fs.mkdir(states, { recursive: true });
      await fs.writeFile(
        path.join(states, "BLUS30443_1_1.SAVESTAT.xz"),
        Buffer.alloc(1025)
      );
      const result = await scanRpcs3Savestates(
        {
          game,
          environmentId: "environment",
          variantId: "variant",
        },
        configRoot
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "partial");
      assert.equal(result.coverage[0].enumeratedCompletely, false);
    } finally {
      await fs.rm(configRoot, { recursive: true, force: true });
    }
  });

  it("keeps an absent savedata root partial for the active profile", async () => {
    const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-rpcs3-"));
    try {
      await fs.mkdir(path.join(homeRoot, "00000001"));
      const result = await scanRpcs3SaveRoot(
        { game, environmentId: "environment", variantId: "variant" },
        homeRoot,
        "00000001"
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "partial");
    } finally {
      await fs.rm(homeRoot, { recursive: true, force: true });
    }
  });
});
