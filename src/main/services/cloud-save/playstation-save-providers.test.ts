import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type {
  Game,
  LocalGameSnapshotContext,
  RestoreManifestFile,
  SnapshotFile,
} from "@types";

import {
  importMcsIntoCard,
  listPs1Saves,
  readPs1SaveContents,
  PS1_CARD_BYTES,
  PS1_BLOCK_BYTES,
} from "../emulators/ps1-memory-card/index.js";
import {
  buildPsuBuffer,
  DF,
  importPsuIntoCard,
  listSaves,
  parsePsuBuffer,
  readSaveContents,
} from "../emulators/ps2-memory-card/index.js";
import {
  scanDuckstationSaves,
  validateDuckstationManualCardForGame,
  type DuckstationSaveConfig,
} from "./duckstation-save-provider.js";
import {
  scanPcsx2Saves,
  validatePcsx2ManualCardForGame,
  type Pcsx2SaveConfig,
} from "./pcsx2-save-provider.js";
import { applyPlaystationCardRestore } from "./playstation-card-restore.js";
import { mergeUserVariantSnapshots } from "./merge-user-variant-snapshots.js";
import { sha256 } from "./playstation-save-common.js";

const game = {
  shop: "launchbox",
  objectId: "test",
  discs: [{ sku: "SCUS-94163" }],
} as Game;
const ps2Game = {
  shop: "launchbox",
  objectId: "test-ps2",
  discs: [{ sku: "SLUS-20294" }],
} as Game;
const context = (target: Game) => ({
  game: target,
  environmentId: "environment",
  variantId: "variant",
});
const manifestFile = (rawPath: string, relativePath: string) =>
  ({ variantId: "variant", rawPath, relativePath }) as RestoreManifestFile;

const createPs1Card = async (filePath: string) => {
  const card = Buffer.alloc(PS1_CARD_BYTES);
  card.write("MC", 0, "ascii");
  for (let block = 1; block <= 15; block += 1) {
    card.writeUInt32LE(0xa0, block * 128);
  }
  await fs.writeFile(filePath, card);
};

const mcs = (identifier: string, value: number, blocks = 1) => {
  const frame = Buffer.alloc(128);
  frame.writeUInt32LE(0x51, 0);
  frame.writeUInt32LE(blocks * PS1_BLOCK_BYTES, 4);
  frame.writeUInt16LE(0xffff, 8);
  frame.write(identifier, 10, "latin1");
  return Buffer.concat([
    frame,
    ...Array.from({ length: blocks }, () =>
      Buffer.alloc(PS1_BLOCK_BYTES, value)
    ),
  ]);
};

const createPs2Card = async (filePath: string) => {
  // Small but structurally valid no-ECC card: superblock, IFC, FAT and root.
  // Real parser and writer exercise cluster chains instead of mocks.
  const card = Buffer.alloc(64 * 1024);
  card.write("Sony PS2 Memory Card Format ", 0, "latin1");
  card.writeUInt16LE(512, 0x28);
  card.writeUInt16LE(2, 0x2a);
  card.writeUInt16LE(16, 0x2c);
  card.writeUInt32LE(64, 0x30);
  card.writeUInt32LE(3, 0x34);
  card.writeUInt32LE(64, 0x38);
  card.writeUInt32LE(0, 0x3c);
  card.writeUInt32LE(1, 0x50);
  card.writeInt8(2, 0x150);
  card.writeUInt32LE(2, 1024);
  for (let cluster = 0; cluster < 256; cluster += 1) {
    card.writeUInt32LE(
      cluster === 0 ? 0xffffffff : 0x7fffffff,
      2048 + cluster * 4
    );
  }
  const root = 3 * 1024;
  card.writeUInt16LE(DF.DIR | DF.EXISTS, root);
  card.writeUInt32LE(2, root + 4);
  card.write(".", root + 0x40, "latin1");
  card.writeUInt16LE(DF.DIR | DF.EXISTS, root + 512);
  card.write("..", root + 512 + 0x40, "latin1");
  await fs.writeFile(filePath, card);
};

const psu = (folderName: string, value: number, size = 4) => {
  const data = Buffer.alloc(size, value);
  return buildPsuBuffer({
    folderName,
    folderMode: DF.DIR | DF.EXISTS,
    folderCreatedRaw: Buffer.alloc(8),
    folderModifiedRaw: Buffer.alloc(8),
    files: [
      {
        name: "DATA.BIN",
        length: size,
        mode: DF.FILE | DF.EXISTS,
        createdSecs: 0,
        modifiedSecs: 0,
        createdRaw: Buffer.alloc(8),
        modifiedRaw: Buffer.alloc(8),
        data,
      },
    ],
  });
};

describe("PlayStation Cloud Save V2", () => {
  it("accepts formatted empty and shared cards as manual restore destinations", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-ps-card-bind-")
    );
    try {
      const ps1 = path.join(root, "empty.mcd");
      const ps2 = path.join(root, "empty.ps2");
      const folder = path.join(root, "folder.ps2");
      await createPs1Card(ps1);
      await createPs2Card(ps2);
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, "_pcsx2_superblock"), "formatted");

      assert.equal(await validateDuckstationManualCardForGame(game, ps1), true);
      assert.equal(await validatePcsx2ManualCardForGame(ps2Game, ps2), true);
      assert.equal(await validatePcsx2ManualCardForGame(ps2Game, folder), true);

      assert.equal(
        (await importMcsIntoCard(ps1, mcs("BASCUS-99999OTHER", 1))).ok,
        true
      );
      assert.equal(
        (await importPsuIntoCard(ps2, psu("BASLUS-99999SAVE", 1))).ok,
        true
      );
      const other = path.join(folder, "BASLUS-99999SAVE");
      await fs.mkdir(other);
      await fs.writeFile(path.join(other, "DATA.BIN"), "other");
      assert.equal(await validateDuckstationManualCardForGame(game, ps1), true);
      assert.equal(await validatePcsx2ManualCardForGame(ps2Game, ps2), true);
      assert.equal(await validatePcsx2ManualCardForGame(ps2Game, folder), true);

      const unrelated = path.join(root, "not-a-card");
      await fs.mkdir(unrelated);
      assert.equal(
        await validatePcsx2ManualCardForGame(ps2Game, unrelated),
        false
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps anchored saves when a configured card or state directory disappears", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps-missing-"));
    try {
      const duckConfig: DuckstationSaveConfig = {
        iniPath: path.join(root, "settings.ini"),
        memcardsDir: path.join(root, "missing-ps1-cards"),
        statesDir: path.join(root, "missing-ps1-states"),
        get: (section, key) =>
          section === "MemoryCards" && key === "Card1Type"
            ? "Shared"
            : section === "MemoryCards" && key === "Card1Path"
              ? "card.mcd"
              : "None",
      };
      const pcsx2Config: Pcsx2SaveConfig = {
        iniPath: path.join(root, "inis", "PCSX2.ini"),
        cardsDir: path.join(root, "missing-ps2-cards"),
        statesDir: path.join(root, "missing-ps2-states"),
        get: (section, key) =>
          section === "MemoryCards" && key === "Slot2_Enable" ? "false" : null,
      };
      const coverage = [
        ...(await scanDuckstationSaves(context(game), duckConfig)).coverage,
        ...(await scanPcsx2Saves(context(ps2Game), pcsx2Config)).coverage,
      ];
      const rawPaths = [
        "<emulator>/duckstation-card/SCUS-94163/1",
        "<emulator>/duckstation-state/SCUS-94163",
        "<emulator>/pcsx2-card/SLUS-20294/1",
        "<emulator>/pcsx2-folder/SLUS-20294/1",
        "<emulator>/pcsx2-state/SLUS-20294",
      ];
      for (const rawPath of rawPaths) {
        const match = coverage.find((item) => item.rawPath === rawPath);
        assert.equal(match?.outcome, "partial", rawPath);
        assert.equal(match?.enumeratedCompletely, false, rawPath);

        const remote: SnapshotFile = {
          variantId: "variant",
          rawPath,
          relativePath: "save.bin",
          hash: "a".repeat(64),
          sizeBytes: 4,
          lastModifiedAt: "2026-09-28T00:00:00.000Z",
        };
        const local = {
          files: [],
          coverage: [match],
          variants: [{ variantId: "variant", kind: "default" }],
          environmentId: "environment",
        } as unknown as LocalGameSnapshotContext;
        const merged = mergeUserVariantSnapshots({
          local,
          remoteVariants: [{ variantId: "variant", kind: "default" }],
          remoteFiles: [remote],
          base: {
            schemaVersion: 4,
            environmentId: "environment",
            baseSnapshotId: "existing",
            baseVersion: 1,
            baseAggregateHash: "b".repeat(64),
            entries: [remote],
            unresolvedRemoteEntryIds: [],
            updatedAt: "2026-09-28T00:00:00.000Z",
          },
        });
        assert.deepEqual(merged.files, [remote], rawPath);
        assert.deepEqual(merged.deleteRemoteEntryIds, [], rawPath);
      }

      await fs.mkdir(duckConfig.statesDir);
      await fs.mkdir(pcsx2Config.statesDir);
      const emptyStateCoverage = [
        ...(await scanDuckstationSaves(context(game), duckConfig)).coverage,
        ...(await scanPcsx2Saves(context(ps2Game), pcsx2Config)).coverage,
      ];
      for (const rawPath of [rawPaths[1], rawPaths[4]]) {
        assert.equal(
          emptyStateCoverage.find((item) => item.rawPath === rawPath)?.outcome,
          "scanned",
          rawPath
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps DuckStation states tied to the disc serial", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps1-state-"));
    try {
      const statesDir = path.join(root, "savestates");
      await fs.mkdir(statesDir);
      for (const name of [
        "SCUS-94163_1.sav",
        "SCUS-94163_resume.sav",
        "SCUS-99999_1.sav",
      ]) {
        await fs.writeFile(path.join(statesDir, name), name);
      }
      const config: DuckstationSaveConfig = {
        iniPath: path.join(root, "settings.ini"),
        memcardsDir: path.join(root, "memcards"),
        statesDir,
        get: () => "None",
      };
      const result = await scanDuckstationSaves(context(game), config);
      assert.deepEqual(result.files.map((file) => file.relativePath).sort(), [
        "SCUS-94163_1.sav",
        "SCUS-94163_resume.sav",
      ]);
      assert.ok(
        result.files.every(
          (file) => file.stateMetadata?.emulatorId === "duckstation"
        )
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("scans PCSX2 folder cards without copying another game's folder", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps2-folder-"));
    try {
      const cardsDir = path.join(root, "memcards");
      const card = path.join(cardsDir, "Mcd001.ps2");
      const own = path.join(card, "BASLUS-20294SAVE");
      const other = path.join(card, "BASLUS-99999SAVE");
      await fs.mkdir(own, { recursive: true });
      await fs.mkdir(other);
      await fs.writeFile(path.join(own, "DATA.BIN"), "own");
      await fs.writeFile(path.join(own, "_pcsx2_meta_directory"), "meta");
      await fs.writeFile(path.join(other, "DATA.BIN"), "other");
      await fs.writeFile(path.join(card, "_pcsx2_superblock"), "shared");
      const statesDir = path.join(root, "sstates");
      await fs.mkdir(statesDir);
      await fs.writeFile(
        path.join(statesDir, "SLUS-20294 (A1B2C3D4).00.p2s"),
        "own state"
      );
      await fs.writeFile(
        path.join(statesDir, "SLUS-99999 (A1B2C3D4).00.p2s"),
        "other state"
      );
      const config: Pcsx2SaveConfig = {
        iniPath: path.join(root, "inis", "PCSX2.ini"),
        cardsDir,
        statesDir,
        get: (section, key) =>
          section === "MemoryCards" && key === "Slot2_Enable" ? "false" : null,
      };
      const result = await scanPcsx2Saves(context(ps2Game), config);
      assert.equal(await validatePcsx2ManualCardForGame(ps2Game, card), true);
      assert.deepEqual(
        result.files.map((file) => file.relativePath).sort(),
        [
          "BASLUS-20294SAVE/DATA.BIN",
          "BASLUS-20294SAVE/_pcsx2_meta_directory",
          "SLUS-20294 (A1B2C3D4).00.p2s",
        ].sort()
      );
      assert.equal(
        result.files.find((file) => file.relativePath.endsWith(".p2s"))
          ?.stateMetadata?.emulatorId,
        "pcsx2"
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps two manually selected PCSX2 folder cards in separate slots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps2-slots-"));
    try {
      const first = path.join(root, "first.ps2");
      const second = path.join(root, "second.ps2");
      for (const card of [first, second]) {
        const save = path.join(card, "BASLUS-20294SAVE");
        await fs.mkdir(save, { recursive: true });
        await fs.writeFile(path.join(save, "DATA.BIN"), card);
      }
      const config: Pcsx2SaveConfig = {
        iniPath: path.join(root, "inis", "PCSX2.ini"),
        cardsDir: root,
        statesDir: path.join(root, "sstates"),
        get: () => null,
      };
      const result = await scanPcsx2Saves(
        context(ps2Game),
        config,
        new Map([
          ["1", first],
          ["2", second],
        ])
      );
      assert.deepEqual(result.files.map((file) => file.rawPath).sort(), [
        "<emulator>/pcsx2-folder/SLUS-20294/1",
        "<emulator>/pcsx2-folder/SLUS-20294/2",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("exports only the game's entry from a shared DuckStation card", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps1-export-"));
    try {
      const card = path.join(root, "shared_card_1.mcd");
      await createPs1Card(card);
      assert.equal(
        (await importMcsIntoCard(card, mcs("BASCUS-94163OWN", 1))).ok,
        true
      );
      assert.equal(
        (await importMcsIntoCard(card, mcs("BASCUS-99999OTHER", 2))).ok,
        true
      );
      const config: DuckstationSaveConfig = {
        iniPath: path.join(root, "settings.ini"),
        memcardsDir: root,
        statesDir: path.join(root, "savestates"),
        get: (section, key) =>
          section === "MemoryCards" && key === "Card1Type"
            ? "Shared"
            : section === "MemoryCards" && key === "Card1Path"
              ? "shared_card_1.mcd"
              : "None",
      };
      const result = await scanDuckstationSaves(
        context(game),
        config,
        new Map(),
        root
      );
      assert.deepEqual(
        result.files.map((file) => file.relativePath),
        [`${sha256("BASCUS-94163OWN")}.mcs`]
      );
      assert.ok(result.files.every((file) => file.absolutePath !== card));
      assert.equal(
        (await fs.readFile(result.files[0].absolutePath)).length,
        128 + PS1_BLOCK_BYTES
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("imports a PS1 entry without changing a sibling save", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps1-card-"));
    try {
      const card = path.join(root, "shared_card_1.mcd");
      await createPs1Card(card);
      const own = "BASCUS-94163OWN";
      const other = "BASCUS-99999OTHER";
      assert.equal((await importMcsIntoCard(card, mcs(own, 1))).ok, true);
      assert.equal((await importMcsIntoCard(card, mcs(other, 2))).ok, true);
      assert.equal(
        await validateDuckstationManualCardForGame(game, card),
        true
      );
      const originalOther = await readPs1SaveContents(card, other);
      const staged = path.join(root, `${sha256(own)}.mcs`);
      await fs.writeFile(staged, mcs(own, 3));
      await applyPlaystationCardRestore(game, [
        {
          file: manifestFile(
            "<emulator>/duckstation-card/SCUS-94163/1",
            path.basename(staged)
          ),
          stagedPath: staged,
          targetPath: card,
        },
      ]);
      assert.equal((await readPs1SaveContents(card, own))?.blocks[0].at(0), 3);
      assert.deepEqual(
        (await readPs1SaveContents(card, other))?.blocks,
        originalOther?.blocks
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back all writes when a later card import fails", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-ps1-rollback-")
    );
    try {
      const card = path.join(root, "shared_card_1.mcd");
      await createPs1Card(card);
      const own = "BASCUS-94163OWN";
      const other = "BASCUS-99999OTHER";
      assert.equal((await importMcsIntoCard(card, mcs(own, 1))).ok, true);
      assert.equal((await importMcsIntoCard(card, mcs(other, 2))).ok, true);
      const original = await fs.readFile(card);
      const update = path.join(root, `${sha256(own)}.mcs`);
      const oversizedName = "BASCUS-94163BIG";
      const oversized = path.join(root, `${sha256(oversizedName)}.mcs`);
      await fs.writeFile(update, mcs(own, 3));
      await fs.writeFile(oversized, mcs(oversizedName, 4, 15));
      await assert.rejects(
        applyPlaystationCardRestore(game, [
          {
            file: manifestFile(
              "<emulator>/duckstation-card/SCUS-94163/1",
              path.basename(update)
            ),
            stagedPath: update,
            targetPath: card,
          },
          {
            file: manifestFile(
              "<emulator>/duckstation-card/SCUS-94163/1",
              path.basename(oversized)
            ),
            stagedPath: oversized,
            targetPath: card,
          },
        ])
      );
      assert.deepEqual(await fs.readFile(card), original);
      assert.equal((await listPs1Saves(card))?.saves.length, 2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("imports only one PS2 image-card entry and rolls back a failed batch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-ps2-image-"));
    try {
      const card = path.join(root, "Mcd001.ps2");
      await createPs2Card(card);
      const own = "BASLUS-20294SAVE";
      const other = "BASLUS-99999SAVE";
      assert.equal((await importPsuIntoCard(card, psu(own, 1))).ok, true);
      assert.equal((await importPsuIntoCard(card, psu(other, 2))).ok, true);
      assert.equal((await listSaves(card))?.saves.length, 2);
      const config: Pcsx2SaveConfig = {
        iniPath: path.join(root, "inis", "PCSX2.ini"),
        cardsDir: root,
        statesDir: path.join(root, "sstates"),
        get: (section, key) =>
          section === "MemoryCards" && key === "Slot2_Enable" ? "false" : null,
      };
      const discovered = await scanPcsx2Saves(
        context(ps2Game),
        config,
        new Map(),
        root
      );
      assert.deepEqual(
        discovered.files.map((file) => file.relativePath),
        [`${sha256(own)}.psu`]
      );
      assert.equal(
        parsePsuBuffer(await fs.readFile(discovered.files[0].absolutePath))
          ?.folderName,
        own
      );
      const sibling = await readSaveContents(card, other);
      const ownStage = path.join(root, `${sha256(own)}.psu`);
      await fs.writeFile(ownStage, psu(own, 3));
      await applyPlaystationCardRestore(ps2Game, [
        {
          file: manifestFile(
            "<emulator>/pcsx2-card/SLUS-20294/1",
            path.basename(ownStage)
          ),
          stagedPath: ownStage,
          targetPath: card,
        },
      ]);
      assert.equal((await readSaveContents(card, own))?.files[0].data.at(0), 3);
      assert.deepEqual(
        (await readSaveContents(card, other))?.files,
        sibling?.files
      );

      const beforeFailedBatch = await fs.readFile(card);
      const oversizedName = "BASLUS-20294LARGE";
      const oversizedStage = path.join(root, `${sha256(oversizedName)}.psu`);
      await fs.writeFile(oversizedStage, psu(oversizedName, 7, 64 * 1024));
      await fs.writeFile(ownStage, psu(own, 4));
      await assert.rejects(
        applyPlaystationCardRestore(ps2Game, [
          {
            file: manifestFile(
              "<emulator>/pcsx2-card/SLUS-20294/1",
              path.basename(ownStage)
            ),
            stagedPath: ownStage,
            targetPath: card,
          },
          {
            file: manifestFile(
              "<emulator>/pcsx2-card/SLUS-20294/1",
              path.basename(oversizedStage)
            ),
            stagedPath: oversizedStage,
            targetPath: card,
          },
        ])
      );
      assert.deepEqual(await fs.readFile(card), beforeFailedBatch);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
