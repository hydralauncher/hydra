import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game, RestoreManifestFile } from "@types";

import {
  applyDolphinRawCardRestore,
  dolphinGciFileName,
  dolphinRawCardPath,
  extractDolphinRawCardGame,
  mergeDolphinRawCard,
  parseDolphinRawCard,
  validateDolphinManualRawCard,
} from "./dolphin-raw-card.js";
import { discoverDolphinRawCard } from "./dolphin-save-provider.js";

const BLOCK = 0x2000;
const game = { discs: [{ sku: "GM8E01" }] } as Game;

const checksum = (
  buffer: Buffer,
  block: number,
  start: number,
  end: number,
  sumOffset: number,
  inverseOffset: number
) => {
  let sum = 0;
  let inverse = 0;
  for (let offset = start; offset < end; offset += 2) {
    const word = buffer.readUInt16BE(block * BLOCK + offset);
    sum = (sum + word) & 0xffff;
    inverse = (inverse + (word ^ 0xffff)) & 0xffff;
  }
  buffer.writeUInt16BE(sum === 0xffff ? 0 : sum, block * BLOCK + sumOffset);
  buffer.writeUInt16BE(
    inverse === 0xffff ? 0 : inverse,
    block * BLOCK + inverseOffset
  );
};

const gci = (gameId: string, name: string, fill: number) => {
  const value = Buffer.alloc(0x40 + BLOCK, fill);
  value.fill(0xff, 0, 0x40);
  value.write(gameId, 0, "ascii");
  value.write(name, 8, "ascii");
  value.writeUInt16BE(5, 0x36);
  value.writeUInt16BE(1, 0x38);
  return value;
};

const cardWithTwoGames = (ownName = "MARIO") => {
  const card = Buffer.alloc(64 * BLOCK, 0xff);
  for (const dir of [1, 2]) {
    card.fill(0xff, dir * BLOCK, (dir + 1) * BLOCK);
    gci("GM8E01", ownName, 0x11).copy(card, dir * BLOCK, 0, 0x40);
    gci("GZLE01", "ZELDA", 0x22).copy(card, dir * BLOCK + 0x40, 0, 0x40);
    card.writeUInt16BE(5, dir * BLOCK + 0x36);
    card.writeUInt16BE(6, dir * BLOCK + 0x40 + 0x36);
    card.writeUInt16BE(0, dir * BLOCK + 0x1ffa);
    checksum(card, dir, 0, 0x1ffc, 0x1ffc, 0x1ffe);
  }
  for (const bat of [3, 4]) {
    card.fill(0, bat * BLOCK, (bat + 1) * BLOCK);
    card.writeUInt16BE(57, bat * BLOCK + 6);
    card.writeUInt16BE(6, bat * BLOCK + 8);
    card.writeUInt16BE(0xffff, bat * BLOCK + 0x0a);
    card.writeUInt16BE(0xffff, bat * BLOCK + 0x0c);
    checksum(card, bat, 4, BLOCK, 0, 2);
  }
  card.fill(0x11, 5 * BLOCK, 6 * BLOCK);
  card.fill(0x22, 6 * BLOCK, 7 * BLOCK);
  return card;
};

describe("Dolphin RAW card per-game restore", () => {
  it("omits serial-bound saves from the snapshot and leaves coverage partial", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-card-")
    );
    try {
      const cardPath = path.join(root, "MemoryCardA.USA.raw");
      await fs.writeFile(cardPath, cardWithTwoGames("PSO_SYSTEM"));
      const result = await discoverDolphinRawCard(
        { game, environmentId: "environment", variantId: "variant" },
        cardPath,
        "A",
        "GM8E01"
      );
      assert.deepEqual(result.files, []);
      assert.equal(result.coverage[0].outcome, "partial");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("extracts only the selected game's GCI and preserves another game's bytes", () => {
    const original = cardWithTwoGames();
    const exported = extractDolphinRawCardGame(
      parseDolphinRawCard(original),
      "GM8E01"
    );
    assert.equal(exported.length, 1);
    assert.equal(
      exported[0].buffer.subarray(0x40).every((byte) => byte === 0x11),
      true
    );

    const merged = mergeDolphinRawCard(original, "GM8E01", [
      gci("GM8E01", "MARIO", 0x77),
    ]);
    assert.equal(
      merged
        .subarray(6 * BLOCK, 7 * BLOCK)
        .equals(original.subarray(6 * BLOCK, 7 * BLOCK)),
      true
    );
    const other = extractDolphinRawCardGame(
      parseDolphinRawCard(merged),
      "GZLE01"
    );
    assert.equal(other.length, 1);
    assert.equal(
      other[0].buffer.subarray(0x40).every((byte) => byte === 0x22),
      true
    );
    assert.equal(
      extractDolphinRawCardGame(parseDolphinRawCard(merged), "GM8E01")[0]
        .buffer.subarray(0x40)
        .every((byte) => byte === 0x77),
      true
    );
  });

  it("rejects another game's GCI and a damaged BAT without modifying the card", () => {
    const original = cardWithTwoGames();
    assert.throws(
      () =>
        mergeDolphinRawCard(original, "GM8E01", [gci("GZLE01", "ZELDA", 0x33)]),
      /wrong_game/
    );
    const invalid = Buffer.from(original);
    invalid.writeUInt16BE(0, 3 * BLOCK);
    assert.throws(() => parseDolphinRawCard(invalid), /metadata_invalid/);
    assert.equal(original.equals(cardWithTwoGames()), true);
  });

  it("refuses serial-bound GameCube saves until Dolphin can re-sign them", () => {
    const original = cardWithTwoGames();
    assert.throws(
      () =>
        mergeDolphinRawCard(original, "GM8E01", [
          gci("GM8E01", "PSO_SYSTEM", 0x33),
        ]),
      /serial_bound_save/
    );
    assert.equal(original.equals(cardWithTwoGames()), true);
  });

  it("validates a manual card and imports a staged GCI transactionally", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-card-")
    );
    try {
      const targetPath = path.join(root, "MemoryCardA.USA.raw");
      const stagedPath = path.join(root, "incoming.gci");
      const save = gci("GM8E01", "MARIO", 0x66);
      await fs.writeFile(targetPath, cardWithTwoGames());
      await fs.writeFile(stagedPath, save);
      assert.equal(await validateDolphinManualRawCard(game, targetPath), true);
      assert.equal(
        await validateDolphinManualRawCard(
          { discs: [{ sku: "AAAA01" }] } as Game,
          targetPath
        ),
        false
      );
      const file = {
        rawPath: dolphinRawCardPath("A", "GM8E01"),
        relativePath: dolphinGciFileName(save.subarray(0, 0x40)),
      } as RestoreManifestFile;
      await applyDolphinRawCardRestore(game, [
        { file, stagedPath, targetPath },
      ]);
      const updated = parseDolphinRawCard(await fs.readFile(targetPath));
      assert.equal(
        extractDolphinRawCardGame(updated, "GM8E01")[0]
          .buffer.subarray(0x40)
          .every((byte) => byte === 0x66),
        true
      );
      assert.equal(
        extractDolphinRawCardGame(updated, "GZLE01")[0]
          .buffer.subarray(0x40)
          .every((byte) => byte === 0x22),
        true
      );
      assert.deepEqual((await fs.readdir(root)).sort(), [
        "MemoryCardA.USA.raw",
        "incoming.gci",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("leaves the card untouched when a staged entry belongs to another game", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-card-")
    );
    try {
      const targetPath = path.join(root, "MemoryCardA.USA.raw");
      const stagedPath = path.join(root, "incoming.gci");
      const original = cardWithTwoGames();
      await fs.writeFile(targetPath, original);
      await fs.writeFile(stagedPath, gci("GZLE01", "ZELDA", 0x66));
      const file = {
        rawPath: dolphinRawCardPath("A", "GM8E01"),
        relativePath: dolphinGciFileName(
          gci("GM8E01", "MARIO", 0x66).subarray(0, 0x40)
        ),
      } as RestoreManifestFile;
      await assert.rejects(
        () =>
          applyDolphinRawCardRestore(game, [{ file, stagedPath, targetPath }]),
        /content_mismatch/
      );
      assert.equal((await fs.readFile(targetPath)).equals(original), true);
      assert.deepEqual((await fs.readdir(root)).sort(), [
        "MemoryCardA.USA.raw",
        "incoming.gci",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
