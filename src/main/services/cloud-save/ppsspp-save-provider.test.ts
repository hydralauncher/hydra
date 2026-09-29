import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game, RestoreManifestFile } from "@types";

import {
  getPpssppGameSaveFileFilter,
  isPpssppGameSaveFile,
  ppssppPspRootFromConfig,
  resolvePpssppRestoreRules,
  scanPpssppSaveRoot,
} from "./ppsspp-save-provider.js";

const game = { discs: [{ sku: "ULUS10000" }] } as Game;
const context = { game, environmentId: "environment", variantId: "variant" };

const sfoForDisc = (discId: string) => {
  const value = Buffer.from(`${discId}\0`, "ascii");
  const sfo = Buffer.alloc(44 + value.length);
  sfo.writeUInt32LE(0x46535000, 0);
  sfo.writeUInt32LE(36, 8);
  sfo.writeUInt32LE(44, 12);
  sfo.writeUInt32LE(1, 16);
  sfo.writeUInt32LE(value.length, 24);
  sfo.write("DISC_ID\0", 36, "ascii");
  value.copy(sfo, 44);
  return sfo;
};

const manifestFile = (rawPath: string, relativePath: string) =>
  ({ variantId: "variant", rawPath, relativePath }) as RestoreManifestFile;

describe("PPSSPP Cloud Save V2", () => {
  it("keeps absent save and state roots partial so a remote snapshot survives", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ppsspp-"));
    try {
      const result = await scanPpssppSaveRoot(context, root);
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage.length, 2);
      assert.ok(
        result.coverage.every(
          (item) => item.outcome === "partial" && !item.enumeratedCompletely
        )
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a configured memstick and recognizes a manual file", () => {
    assert.equal(
      ppssppPspRootFromConfig(
        "/app/memstick/PSP/SYSTEM/ppsspp.ini",
        "MemStickDirectory = /custom/memstick"
      ),
      path.join("/custom/memstick", "PSP")
    );
    assert.equal(
      isPpssppGameSaveFile(
        game,
        path.join("/memstick/PSP/PPSSPP_STATE", "ULUS10000_1.00_0.ppst")
      ),
      true
    );
    assert.equal(
      isPpssppGameSaveFile(
        game,
        path.join("/memstick/PSP/SAVEDATA", "ULUS99999SAVE", "DATA.BIN")
      ),
      false
    );
  });

  it("scans only this disc's savedata, states, undo and companions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ppsspp-"));
    try {
      const ownSlot = path.join(root, "SAVEDATA", "ULUS10000SAVE");
      const otherSlot = path.join(root, "SAVEDATA", "ULUS99999SAVE");
      await fs.mkdir(ownSlot, { recursive: true });
      await fs.mkdir(otherSlot);
      await fs.writeFile(
        path.join(ownSlot, "PARAM.SFO"),
        sfoForDisc("ULUS10000")
      );
      await fs.writeFile(path.join(ownSlot, "DATA.BIN"), "own");
      await fs.writeFile(
        path.join(otherSlot, "PARAM.SFO"),
        sfoForDisc("ULUS99999")
      );
      await fs.writeFile(path.join(otherSlot, "DATA.BIN"), "other");
      const stateRoot = path.join(root, "PPSSPP_STATE");
      await fs.mkdir(stateRoot);
      for (const name of [
        "ULUS10000_1.00_0.ppst",
        "ULUS10000_1.00_0.jpg",
        "ULUS10000_1.00_0.name.txt",
        "ULUS10000_1.00_0.undo.ppst",
        "ULUS10000_1.00_0.undo.jpg",
        "ULUS99999_1.00_0.ppst",
      ]) {
        await fs.writeFile(path.join(stateRoot, name), name);
      }
      const result = await scanPpssppSaveRoot(context, root);
      assert.deepEqual(
        result.files.map((file) => file.relativePath).sort(),
        [
          "ULUS10000SAVE/DATA.BIN",
          "ULUS10000SAVE/PARAM.SFO",
          "ULUS10000_1.00_0.jpg",
          "ULUS10000_1.00_0.name.txt",
          "ULUS10000_1.00_0.ppst",
          "ULUS10000_1.00_0.undo.jpg",
          "ULUS10000_1.00_0.undo.ppst",
        ].sort()
      );
      assert.ok(result.coverage.every((item) => item.outcome === "scanned"));
      assert.ok(
        result.files
          .filter((file) => file.rawPath.includes("/state/"))
          .every((file) => file.stateMetadata?.emulatorId === "ppsspp")
      );
      const filter = getPpssppGameSaveFileFilter(game);
      assert.equal(await filter(path.join(ownSlot, "DATA.BIN")), true);
      assert.equal(await filter(path.join(otherSlot, "DATA.BIN")), false);
      await fs.writeFile(
        path.join(ownSlot, "PARAM.SFO"),
        sfoForDisc("ULUS99999")
      );
      assert.equal(await filter(path.join(ownSlot, "DATA.BIN")), false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("restores owned paths and blocks another game's state and traversal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ppsspp-"));
    try {
      const files = [
        manifestFile(
          "<emulator>/ppsspp/state/ULUS10000",
          "ULUS10000_1.00_0.ppst"
        ),
        manifestFile(
          "<emulator>/ppsspp/state/ULUS10000",
          "ULUS99999_1.00_0.ppst"
        ),
        manifestFile("<emulator>/ppsspp/savedata/ULUS10000", "../DATA.BIN"),
      ];
      const rules = await resolvePpssppRestoreRules(game, files, root);
      assert.equal(rules.size, 1);
      assert.equal(
        [...rules.values()][0].preferredPath,
        path.join(root, "PPSSPP_STATE")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
