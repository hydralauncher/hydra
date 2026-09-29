import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game, RestoreManifestFile } from "@types";

import {
  dolphinSlotEnvironmentSignature,
  getDolphinGameSaveFileFilter,
  resolveDolphinRestoreRules,
  scanDolphinSaveRoot,
} from "./dolphin-save-provider.js";
import {
  canonicalizeDolphinGci,
  mergeDolphinRawCard,
} from "./dolphin-raw-card.js";

const gcGame = {
  platform: "Nintendo GameCube",
  discs: [{ sku: "GM8E01" }],
} as Game;
const wiiGame = {
  platform: "Nintendo Wii",
  discs: [{ sku: "RMGE01" }],
} as Game;
const location = (userDir: string, settings: Record<string, string> = {}) => ({
  userDir,
  configPath: null,
  get: (group: string, key: string) => settings[`${group}.${key}`] ?? null,
});
const context = (game: Game) => ({
  game,
  environmentId: "environment",
  variantId: "variant",
});

const gci = (id: string) => {
  const buffer = Buffer.alloc(0x40 + 0x2000);
  buffer.write(id, 0, "ascii");
  buffer.write("SAVE", 8, "ascii");
  buffer.writeUInt16BE(1, 0x38);
  return buffer;
};

const state = (id: string, version: string) => {
  const buffer = Buffer.alloc(64);
  buffer.write(id, 0, "ascii");
  buffer.writeUInt32LE(version.length, 28);
  buffer.write(version, 32, "ascii");
  return buffer;
};

const manifest = (rawPath: string, relativePath: string) =>
  ({ variantId: "variant", rawPath, relativePath }) as RestoreManifestFile;

const emptyRawCard = () => {
  const blockSize = 0x2000;
  const card = Buffer.alloc(64 * blockSize, 0xff);
  card.writeUInt16BE(4, 0x22);
  const checksum = (
    block: number,
    start: number,
    end: number,
    sumOffset: number,
    inverseOffset: number
  ) => {
    let sum = 0;
    let inverse = 0;
    for (let offset = start; offset < end; offset += 2) {
      const word = card.readUInt16BE(block * blockSize + offset);
      sum = (sum + word) & 0xffff;
      inverse = (inverse + (word ^ 0xffff)) & 0xffff;
    }
    card.writeUInt16BE(sum === 0xffff ? 0 : sum, block * blockSize + sumOffset);
    card.writeUInt16BE(
      inverse === 0xffff ? 0 : inverse,
      block * blockSize + inverseOffset
    );
  };
  checksum(0, 0, 0x1fc, 0x1fc, 0x1fe);
  for (const block of [1, 2]) checksum(block, 0, 0x1ffc, 0x1ffc, 0x1ffe);
  for (const block of [3, 4]) {
    card.fill(0, block * blockSize, (block + 1) * blockSize);
    card.writeUInt16BE(59, block * blockSize + 6);
    checksum(block, 4, blockSize, 0, 2);
  }
  return card;
};

describe("Dolphin Cloud Save V2 provider", () => {
  it("invalidates the environment when a GCI folder override changes", () => {
    const first = location("/home/user/Dolphin", {
      "Core.GCIFolderAPath": "/cards/default",
      "Core.GCIFolderAPathOverride": "/cards/first",
    });
    const second = location("/home/user/Dolphin", {
      "Core.GCIFolderAPath": "/cards/default",
      "Core.GCIFolderAPathOverride": "/cards/second",
    });
    assert.notDeepEqual(
      dolphinSlotEnvironmentSignature(first, "A"),
      dolphinSlotEnvironmentSignature(second, "A")
    );
  });

  it("scans and resolves a manual RAW card without Dolphin configured", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-manual-no-config-")
    );
    try {
      const cardPath = path.join(root, "shared.raw");
      const own = gci("GM8E01");
      const other = gci("GZLE01");
      const withOwn = mergeDolphinRawCard(emptyRawCard(), "GM8E01", [own]);
      const card = mergeDolphinRawCard(withOwn, "GZLE01", [other]);
      await fs.writeFile(cardPath, card);
      const manualCards = [{ path: cardPath, slot: "A" }];
      const discovered = await scanDolphinSaveRoot(
        context(gcGame),
        null,
        manualCards
      );
      assert.equal(discovered.files.length, 1);
      assert.equal(
        discovered.files[0].rawPath,
        "<emulator>/dolphin-raw/A/GM8E01"
      );
      assert.equal(
        discovered.coverage.find(
          (item) => item.rawPath === "<emulator>/dolphin-raw/A/GM8E01"
        )?.outcome,
        "scanned"
      );
      const rules = await resolveDolphinRestoreRules(
        gcGame,
        [
          manifest(
            discovered.files[0].rawPath,
            discovered.files[0].relativePath
          ),
        ],
        null,
        manualCards
      );
      assert.equal(rules.size, 1);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("exports canonical GCI folder bytes without modifying the local save", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      const gciRoot = path.join(root, "GC", "USA", "Card A");
      await fs.mkdir(gciRoot, { recursive: true });
      const original = gci("GM8E01");
      original.write("PSO_SYSTEM", 8, "ascii");
      original.writeUInt16BE(2, 0x38);
      const full = Buffer.concat([original, Buffer.alloc(0x2000)]);
      const sourcePath = path.join(gciRoot, "own.gci");
      await fs.writeFile(sourcePath, full);
      const result = await scanDolphinSaveRoot(context(gcGame), location(root));
      const discovered = result.files.find(
        (file) => file.relativePath === "own.gci"
      );
      assert.ok(discovered);
      assert.equal(discovered.rawPath, "<emulator>/dolphin-gci/A/GM8E01");
      assert.equal(
        (await fs.readFile(discovered.absolutePath)).equals(
          canonicalizeDolphinGci(full)
        ),
        true
      );
      assert.equal((await fs.readFile(sourcePath)).equals(full), true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps absent GCI, state and Wii data roots partial", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      for (const game of [gcGame, wiiGame]) {
        const result = await scanDolphinSaveRoot(context(game), location(root));
        assert.deepEqual(result.files, []);
        assert.ok(result.coverage.length >= 2);
        assert.ok(
          result.coverage.every(
            (item) => item.outcome === "partial" && !item.enumeratedCompletely
          )
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("restores Wii save on a new host without TMD, but blocks occupied unbound titles", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      const rawPath = "<emulator>/dolphin-wii/00010000524d4745";
      const files = [manifest(rawPath, "save.dat")];
      let rules = await resolveDolphinRestoreRules(
        wiiGame,
        files,
        location(root)
      );
      assert.equal(rules.size, 1);
      assert.equal(
        [...rules.values()][0].preferredPath,
        path.join(root, "Wii", "title", "00010000", "524d4745", "data")
      );
      const externalNand = path.join(root, "missing-nand");
      const externalLocation = location(root, {
        "General.NANDRootPath": externalNand,
      });
      assert.equal(
        (await resolveDolphinRestoreRules(wiiGame, files, externalLocation))
          .size,
        0
      );
      await fs.mkdir(externalNand);
      assert.equal(
        (await resolveDolphinRestoreRules(wiiGame, files, externalLocation))
          .size,
        1
      );
      const titleRoot = path.join(root, "Wii", "title", "00010000", "524d4745");
      await fs.mkdir(path.join(titleRoot, "data"), { recursive: true });
      await fs.writeFile(
        path.join(titleRoot, "data", "foreign.dat"),
        "foreign"
      );
      rules = await resolveDolphinRestoreRules(wiiGame, files, location(root));
      assert.equal(rules.size, 0);
      await fs.rm(path.join(titleRoot, "data", "foreign.dat"));
      rules = await resolveDolphinRestoreRules(wiiGame, files, location(root));
      assert.equal(rules.size, 1);
      await fs.mkdir(path.join(titleRoot, "content"));
      const foreignTmd = Buffer.alloc(0x19a);
      Buffer.from("00010000524d4745", "hex").copy(foreignTmd, 0x18c);
      foreignTmd.write("99", 0x198, "ascii");
      await fs.writeFile(
        path.join(titleRoot, "content", "title.tmd"),
        foreignTmd
      );
      rules = await resolveDolphinRestoreRules(wiiGame, files, location(root));
      assert.equal(rules.size, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("discovers only this game's GCI and state with version from the state", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      const gciRoot = path.join(root, "GC", "USA", "Card A");
      const stateRoot = path.join(root, "StateSaves");
      await fs.mkdir(gciRoot, { recursive: true });
      await fs.mkdir(stateRoot);
      await fs.writeFile(path.join(gciRoot, "own.gci"), gci("GM8E01"));
      await fs.writeFile(path.join(gciRoot, "other.gci"), gci("GZLE01"));
      await fs.writeFile(
        path.join(stateRoot, "GM8E01.s01"),
        state("GM8E01", "rev123")
      );
      await fs.writeFile(path.join(stateRoot, "GM8E01.s01.dtm"), "movie");
      await fs.writeFile(
        path.join(stateRoot, "GZLE01.s01"),
        state("GZLE01", "rev123")
      );
      const result = await scanDolphinSaveRoot(context(gcGame), location(root));
      assert.deepEqual(result.files.map((file) => file.relativePath).sort(), [
        "GM8E01.s01",
        "GM8E01.s01.dtm",
        "own.gci",
      ]);
      assert.deepEqual(
        result.files.find((file) => file.relativePath === "GM8E01.s01")
          ?.stateMetadata,
        { emulatorId: "dolphin", version: "rev123" }
      );
      const filter = getDolphinGameSaveFileFilter(gcGame);
      assert.equal(await filter(path.join(gciRoot, "own.gci")), true);
      assert.equal(await filter(path.join(gciRoot, "other.gci")), false);
      assert.equal(await filter(path.join(stateRoot, "GZLE01.s01")), false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("restores only matching Game ID paths, rejecting foreign and traversal paths", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      const files = [
        manifest("<emulator>/dolphin-gci/A/GM8E01", "own.gci"),
        manifest("<emulator>/dolphin-gci/A/GZLE01", "other.gci"),
        manifest("<emulator>/dolphin-state/GM8E01", "GZLE01.s01"),
        manifest("<emulator>/dolphin-state/GM8E01", "../GM8E01.s01"),
      ];
      const rules = await resolveDolphinRestoreRules(
        gcGame,
        files,
        location(root)
      );
      assert.equal(rules.size, 1);
      assert.equal(
        [...rules.values()][0].preferredPath,
        path.join(root, "GC", "USA", "Card A")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not restore GCI into a disconnected configured folder", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-missing-gci-root-")
    );
    try {
      const configured = path.join(root, "disconnected", "cards");
      const configuredLocation = location(root, {
        "Core.GCIFolderAPathOverride": configured,
      });
      const files = [manifest("<emulator>/dolphin-gci/A/GM8E01", "own.gci")];
      assert.equal(
        (await resolveDolphinRestoreRules(gcGame, files, configuredLocation))
          .size,
        0
      );
      await fs.mkdir(configured, { recursive: true });
      const rules = await resolveDolphinRestoreRules(
        gcGame,
        files,
        configuredLocation
      );
      assert.equal(rules.size, 1);
      assert.equal(
        [...rules.values()][0].preferredPath,
        path.join(configured, "USA")
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("honors a game-specific card mode override", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      await fs.mkdir(path.join(root, "GameSettings"));
      await fs.writeFile(
        path.join(root, "GameSettings", "GM8E01.ini"),
        "[Core]\nSlotA = 1\n"
      );
      const files = [manifest("<emulator>/dolphin-gci/A/GM8E01", "own.gci")];
      const rules = await resolveDolphinRestoreRules(
        gcGame,
        files,
        location(root)
      );
      assert.equal(rules.size, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("scans Wii NAND only when TMD binds full Game ID", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-dolphin-provider-")
    );
    try {
      const titleRoot = path.join(root, "Wii", "title", "00010000", "524d4745");
      const dataRoot = path.join(titleRoot, "data");
      await fs.mkdir(dataRoot, { recursive: true });
      await fs.mkdir(path.join(titleRoot, "content"));
      await fs.writeFile(path.join(dataRoot, "save.dat"), "own");
      const tmd = Buffer.alloc(0x19a);
      Buffer.from("00010000524d4745", "hex").copy(tmd, 0x18c);
      tmd.write("01", 0x198, "ascii");
      await fs.writeFile(path.join(titleRoot, "content", "title.tmd"), tmd);
      let result = await scanDolphinSaveRoot(context(wiiGame), location(root));
      assert.equal(
        result.files.some((file) => file.relativePath === "save.dat"),
        true
      );
      const filter = getDolphinGameSaveFileFilter(wiiGame);
      assert.equal(await filter(path.join(dataRoot, "save.dat")), true);
      tmd.write("99", 0x198, "ascii");
      await fs.writeFile(path.join(titleRoot, "content", "title.tmd"), tmd);
      result = await scanDolphinSaveRoot(context(wiiGame), location(root));
      assert.equal(
        result.files.some((file) => file.relativePath === "save.dat"),
        false
      );
      assert.equal(
        result.coverage.find((item) => item.rawPath?.includes("dolphin-wii"))
          ?.outcome,
        "partial"
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
