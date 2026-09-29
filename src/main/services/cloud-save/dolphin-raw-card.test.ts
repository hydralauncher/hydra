import assert from "node:assert/strict";
import { existsSync, promises as fs } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type {
  Game,
  LocalGameSnapshotSourceFile,
  RestoreManifestFile,
} from "@types";

import {
  applyDolphinRawCardRestore,
  canonicalizeDolphinGci,
  dolphinGciFileName,
  dolphinRawCardPath,
  extractDolphinRawCardGame,
  mergeDolphinRawCard,
  parseDolphinRawCard,
  removeDolphinRawCardGcis,
  resignDolphinSerialBoundGci,
  validateDolphinManualRawCard,
} from "./dolphin-raw-card.js";
import { discoverDolphinRawCard } from "./dolphin-save-provider.js";
import {
  deleteResolvedEmulatorCardSaves,
  type CardItem,
} from "./delete-emulator-card-saves.js";
import { buildNativeDeleteTargets } from "./build-native-delete-targets.js";
import { sha256 } from "./playstation-save-common.js";

const addonPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../hydra-native/hydra-native.node"
);
const require = createRequire(import.meta.url);

const BLOCK = 0x2000;
const game = { discs: [{ sku: "GM8E01" }] } as Game;
const manifestFile = (rawPath: string, relativePath: string) =>
  ({ variantId: "variant", rawPath, relativePath }) as RestoreManifestFile;

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

const gci = (gameId: string, name: string, fill: number, blocks = 1) => {
  const value = Buffer.alloc(0x40 + blocks * BLOCK, fill);
  value.fill(0xff, 0, 0x40);
  value.write(gameId, 0, "ascii");
  value.write(name, 8, "ascii");
  value.writeUInt16BE(5, 0x36);
  value.writeUInt16BE(blocks, 0x38);
  return value;
};

const cardWithTwoGames = (ownName = "MARIO", ownBlocks = 1) => {
  const card = Buffer.alloc(64 * BLOCK, 0xff);
  for (let offset = 0; offset < 32; offset++) {
    card[offset] = (offset * 13 + 7) & 0xff;
  }
  card.writeUInt16BE(4, 0x22);
  checksum(card, 0, 0, 0x1fc, 0x1fc, 0x1fe);
  for (const dir of [1, 2]) {
    card.fill(0xff, dir * BLOCK, (dir + 1) * BLOCK);
    gci("GM8E01", ownName, 0x11, ownBlocks).copy(card, dir * BLOCK, 0, 0x40);
    gci("GZLE01", "ZELDA", 0x22).copy(card, dir * BLOCK + 0x40, 0, 0x40);
    card.writeUInt16BE(5, dir * BLOCK + 0x36);
    card.writeUInt16BE(5 + ownBlocks, dir * BLOCK + 0x40 + 0x36);
    card.writeUInt16BE(0, dir * BLOCK + 0x1ffa);
    checksum(card, dir, 0, 0x1ffc, 0x1ffc, 0x1ffe);
  }
  for (const bat of [3, 4]) {
    card.fill(0, bat * BLOCK, (bat + 1) * BLOCK);
    card.writeUInt16BE(58 - ownBlocks, bat * BLOCK + 6);
    card.writeUInt16BE(5 + ownBlocks, bat * BLOCK + 8);
    for (let index = 0; index < ownBlocks; index++) {
      card.writeUInt16BE(
        index === ownBlocks - 1 ? 0xffff : 6 + index,
        bat * BLOCK + 0x0a + index * 2
      );
    }
    card.writeUInt16BE(0xffff, bat * BLOCK + 0x0a + ownBlocks * 2);
    checksum(card, bat, 4, BLOCK, 0, 2);
  }
  card.fill(0x11, 5 * BLOCK, (5 + ownBlocks) * BLOCK);
  card.fill(0x22, (5 + ownBlocks) * BLOCK, (6 + ownBlocks) * BLOCK);
  return card;
};

describe("Dolphin RAW card per-game restore", () => {
  it(
    "deletes RAW entry and physical GCI through native guard, preserving sibling saves",
    { skip: !existsSync(addonPath) && "native addon is not built" },
    async () => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "hydra-gc-native-delete-")
      );
      try {
        const native = require(addonPath);
        const rawPath = path.join(root, "MemoryCardA.USA.raw");
        const gciRoot = path.join(root, "GC", "USA", "Card A");
        const gciPath = path.join(gciRoot, "own.gci");
        const siblingPath = path.join(gciRoot, "other.gci");
        const cachedGciPath = path.join(root, "cache", "own.gci");
        await fs.mkdir(gciRoot, { recursive: true });
        await fs.mkdir(path.dirname(cachedGciPath), { recursive: true });
        const raw = cardWithTwoGames();
        const ownRaw = extractDolphinRawCardGame(
          parseDolphinRawCard(raw),
          "GM8E01"
        )[0];
        const siblingRaw = extractDolphinRawCardGame(
          parseDolphinRawCard(raw),
          "GZLE01"
        )[0];
        const physicalGci = gci("GM8E01", "OWN", 0x33);
        const siblingGci = gci("GZLE01", "OTHER", 0x44);
        const canonicalGci = canonicalizeDolphinGci(physicalGci);
        await Promise.all([
          fs.writeFile(rawPath, raw),
          fs.writeFile(gciPath, physicalGci),
          fs.writeFile(siblingPath, siblingGci),
          fs.writeFile(cachedGciPath, canonicalGci),
        ]);
        const source = (
          rawPathId: string,
          relativePath: string,
          absolutePath: string,
          concretePath: string,
          bytes: Buffer
        ) =>
          ({
            variantId: "a".repeat(64),
            rawPath: rawPathId,
            relativePath,
            absolutePath,
            hash: sha256(bytes),
            sizeBytes: bytes.length,
            localBindings: { concretePath },
          }) as LocalGameSnapshotSourceFile;
        const rawSource = source(
          dolphinRawCardPath("A", "GM8E01"),
          ownRaw.fileName,
          path.join(root, "cache", ownRaw.fileName),
          path.join(root, "cache"),
          ownRaw.buffer
        );
        await fs.writeFile(rawSource.absolutePath, ownRaw.buffer);
        const gciSource = source(
          "<emulator>/dolphin-gci/A/GM8E01",
          "own.gci",
          cachedGciPath,
          gciRoot,
          canonicalGci
        );
        const targets = await buildNativeDeleteTargets([rawSource, gciSource]);
        assert.equal(targets.length, 1);
        assert.equal(targets[0].targetPath, gciPath);
        assert.equal(targets[0].expectedHash, sha256(physicalGci));
        const rawItem: CardItem = {
          kind: "dolphin",
          target: rawPath,
          source: rawSource,
          bytes: ownRaw.buffer,
        };
        await fs.writeFile(gciPath, gci("GM8E01", "OWN", 0x55));
        await assert.rejects(
          deleteResolvedEmulatorCardSaves([rawItem], () =>
            native.deleteLocalSaveTargets(targets, [])
          ),
          /cloud_save_delete_target_changed/
        );
        assert.deepEqual(await fs.readFile(rawPath), raw);
        await fs.writeFile(gciPath, physicalGci);
        await deleteResolvedEmulatorCardSaves([rawItem], () =>
          native.deleteLocalSaveTargets(targets, [])
        );
        const result = parseDolphinRawCard(await fs.readFile(rawPath));
        assert.equal(extractDolphinRawCardGame(result, "GM8E01").length, 0);
        assert.deepEqual(
          extractDolphinRawCardGame(result, "GZLE01")[0].buffer,
          siblingRaw.buffer
        );
        await assert.rejects(fs.access(gciPath));
        assert.deepEqual(await fs.readFile(siblingPath), siblingGci);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    }
  );
  it("deletes one RAW entry without changing another game and rolls back failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-gc-delete-"));
    try {
      const target = path.join(root, "MemoryCardA.USA.raw");
      const original = cardWithTwoGames();
      await fs.writeFile(target, original);
      const own = extractDolphinRawCardGame(
        parseDolphinRawCard(original),
        "GM8E01"
      )[0];
      const other = extractDolphinRawCardGame(
        parseDolphinRawCard(original),
        "GZLE01"
      )[0];
      const source = {
        rawPath: dolphinRawCardPath("A", "GM8E01"),
        relativePath: own.fileName,
      } as CardItem["source"];
      const item: CardItem = {
        kind: "dolphin",
        target,
        source,
        bytes: own.buffer,
      };
      await assert.rejects(
        deleteResolvedEmulatorCardSaves([item], async () => {
          throw new Error("native deletion failed");
        }),
        /native deletion failed/
      );
      assert.deepEqual(await fs.readFile(target), original);
      await deleteResolvedEmulatorCardSaves([item], async () => undefined);
      const parsed = parseDolphinRawCard(await fs.readFile(target));
      assert.equal(extractDolphinRawCardGame(parsed, "GM8E01").length, 0);
      assert.deepEqual(
        extractDolphinRawCardGame(parsed, "GZLE01")[0].buffer,
        other.buffer
      );
      assert.throws(
        () => removeDolphinRawCardGcis(original, "GM8E01", [other.fileName]),
        /entry_missing/
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("retains backup instead of overwriting a card changed during delete rollback", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-gc-delete-race-")
    );
    try {
      const target = path.join(root, "MemoryCardA.USA.raw");
      const original = cardWithTwoGames();
      await fs.writeFile(target, original);
      const own = extractDolphinRawCardGame(
        parseDolphinRawCard(original),
        "GM8E01"
      )[0];
      const source = {
        rawPath: dolphinRawCardPath("A", "GM8E01"),
        relativePath: own.fileName,
      } as CardItem["source"];
      const item: CardItem = {
        kind: "dolphin",
        target,
        source,
        bytes: own.buffer,
      };
      const external = Buffer.from(original);
      external[5 * BLOCK] ^= 0x5a;
      await assert.rejects(
        deleteResolvedEmulatorCardSaves([item], async () => {
          await fs.writeFile(target, external);
          throw new Error("native deletion failed");
        }),
        /cloud_save_memory_card_rollback_failed/
      );
      assert.deepEqual(await fs.readFile(target), external);
      const backups = (await fs.readdir(root)).filter((name) =>
        name.includes(".hydra-backup-")
      );
      assert.equal(backups.length, 1);
      assert.deepEqual(
        await fs.readFile(path.join(root, backups[0])),
        original
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite a RAW card changed during restore rollback", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-gc-restore-race-")
    );
    const originalRename = fs.rename;
    try {
      const first = path.join(root, "MemoryCardA.USA.raw");
      const second = path.join(root, "MemoryCardB.USA.raw");
      const staged = path.join(root, "incoming.gci");
      const original = cardWithTwoGames();
      const incoming = gci("GM8E01", "MARIO", 0x33);
      await Promise.all([
        fs.writeFile(first, original),
        fs.writeFile(second, original),
        fs.writeFile(staged, incoming),
      ]);
      let external: Buffer | null = null;
      fs.rename = async (from, to) => {
        if (String(from).includes(".hydra-restore-") && to === second) {
          throw new Error("second card failed");
        }
        await originalRename(from, to);
        if (String(from).includes(".hydra-restore-") && to === first) {
          external = await fs.readFile(first);
          external[5 * BLOCK] ^= 0x5a;
          await fs.writeFile(first, external);
        }
      };
      await assert.rejects(
        applyDolphinRawCardRestore(game, [
          {
            file: manifestFile(
              dolphinRawCardPath("A", "GM8E01"),
              dolphinGciFileName(incoming)
            ),
            stagedPath: staged,
            targetPath: first,
          },
          {
            file: manifestFile(
              dolphinRawCardPath("B", "GM8E01"),
              dolphinGciFileName(incoming)
            ),
            stagedPath: staged,
            targetPath: second,
          },
        ]),
        /dolphin_card_restore_rollback_failed/
      );
      assert.ok(external);
      assert.deepEqual(await fs.readFile(first), external);
      const backups = (await fs.readdir(root)).filter((name) =>
        name.startsWith("MemoryCardA.USA.raw.hydra-backup-")
      );
      assert.equal(backups.length, 1);
      assert.deepEqual(
        await fs.readFile(path.join(root, backups[0])),
        original
      );
    } finally {
      fs.rename = originalRename;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
  it("exports portable serial-bound saves and marks malformed ones partial", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-card-")
    );
    try {
      const cardPath = path.join(root, "MemoryCardA.USA.raw");
      await fs.writeFile(cardPath, cardWithTwoGames("PSO_SYSTEM", 2));
      const result = await discoverDolphinRawCard(
        { game, environmentId: "environment", variantId: "variant" },
        cardPath,
        "A",
        "GM8E01"
      );
      assert.equal(result.files.length, 1);
      assert.equal(result.coverage[0].outcome, "scanned");
      await fs.writeFile(cardPath, cardWithTwoGames("f_zero.dat", 1));
      const malformed = await discoverDolphinRawCard(
        { game, environmentId: "environment", variantId: "variant" },
        cardPath,
        "A",
        "GM8E01"
      );
      assert.deepEqual(malformed.files, []);
      assert.equal(malformed.coverage[0].outcome, "partial");
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

  it("re-signs F-Zero and PSO saves for the destination card", () => {
    for (const [name, blocks] of [
      ["f_zero.dat", 4],
      ["PSO_SYSTEM", 2],
      ["PSO3_SYSTEM", 2],
    ] as const) {
      const original = cardWithTwoGames(name, blocks);
      const incoming = gci("GM8E01", name, 0x33, blocks);
      const signed = resignDolphinSerialBoundGci(
        incoming,
        original.subarray(0, BLOCK)
      );
      assert.equal(signed.equals(incoming), false);
      const merged = mergeDolphinRawCard(original, "GM8E01", [incoming]);
      const parsed = parseDolphinRawCard(merged);
      const own = parsed.entries.find((entry) => entry.gameId === "GM8E01");
      assert.ok(own);
      const physicalData = Buffer.concat(
        own.blocks.map((block) =>
          merged.subarray(block * BLOCK, (block + 1) * BLOCK)
        )
      );
      assert.equal(physicalData.equals(signed.subarray(0x40)), true);
      assert.equal(
        extractDolphinRawCardGame(parsed, "GM8E01")[0].buffer.equals(
          canonicalizeDolphinGci(signed)
        ),
        true
      );
      assert.equal(
        extractDolphinRawCardGame(parseDolphinRawCard(merged), "GZLE01")[0]
          .buffer.subarray(0x40)
          .every((byte) => byte === 0x22),
        true
      );
    }
  });

  it("exports a stable GCI after moving a protected save to another card", () => {
    const source = cardWithTwoGames("PSO_SYSTEM", 2);
    const portable = extractDolphinRawCardGame(
      parseDolphinRawCard(source),
      "GM8E01"
    )[0].buffer;
    const target = Buffer.from(source);
    target[0] ^= 0x5a;
    checksum(target, 0, 0, 0x1fc, 0x1fc, 0x1fe);
    const imported = mergeDolphinRawCard(target, "GM8E01", [portable]);
    const exportedAgain = extractDolphinRawCardGame(
      parseDolphinRawCard(imported),
      "GM8E01"
    )[0].buffer;
    assert.equal(exportedAgain.equals(portable), true);
    assert.equal(
      imported.subarray(0, BLOCK).equals(target.subarray(0, BLOCK)),
      true
    );
  });

  it("matches Dolphin's F-Zero and PSO checksum vectors", () => {
    const header = cardWithTwoGames().subarray(0, BLOCK);
    const fzero = resignDolphinSerialBoundGci(
      gci("GM8E01", "f_zero.dat", 0x33, 4),
      header
    );
    assert.equal(fzero.subarray(0x40, 0x42).toString("hex"), "0e51");
    assert.equal(fzero.subarray(0x20a0, 0x20a2).toString("hex"), "0020");
    assert.equal(fzero.subarray(0x20a6, 0x20a8).toString("hex"), "80c0");
    assert.equal(fzero.subarray(0x2240, 0x2242).toString("hex"), "4000");
    assert.equal(fzero.subarray(0x75c0, 0x75c2).toString("hex"), "e060");
    for (const [name, expected] of [
      ["PSO_SYSTEM", "061cd1f3"],
      ["PSO3_SYSTEM", "84489ee1"],
    ]) {
      const signed = resignDolphinSerialBoundGci(
        gci("GM8E01", name, 0x33, 2),
        header
      );
      assert.equal(signed.subarray(0x2088, 0x208c).toString("hex"), expected);
      assert.equal(
        signed.subarray(0x2198, 0x21a0).toString("hex"),
        "80c00020e0604000"
      );
    }
  });

  it("does not rewrite case-variant save names", () => {
    const original = cardWithTwoGames();
    const variant = gci("GM8E01", "F_ZERO.DAT", 0x33, 4);
    assert.throws(
      () => mergeDolphinRawCard(original, "GM8E01", [variant]),
      /serial_bound_invalid/
    );
  });

  it("refuses malformed serial-bound GCI before touching a card", () => {
    const original = cardWithTwoGames();
    assert.throws(
      () =>
        mergeDolphinRawCard(original, "GM8E01", [
          gci("GM8E01", "f_zero.dat", 0x33),
        ]),
      /serial_bound_invalid/
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
        true
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
