import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

import { scanRpcs3SaveRoot } from "./rpcs3-save-scanner.js";

describe("RPCS3 Cloud Save scanner", () => {
  const game = {
    discs: [{ sku: "BLUS30443" }],
  } as Game;

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
});
